// Creative workspace and command owner. Loaded only when Creative is activated.

export function renderCreativeWorkspaceStudioV3(context, { shell, library, stage, props, timeline, timelineTracks, timelineMeta, title, subtitle, mode, skipStageRender = false }) {
  context.ensureCreativeAssetsHydrated(mode);
  context.ensureCreativeLibrariesHydrated(mode);
  if (mode === 'video' && context.creativeLibraryNavTab === 'blocks') context.ensureCreativeHtmlMotionBlocksHydrated();
  shell.style.display = 'flex';
  shell.style.position = 'relative';
  shell.style.zIndex = '2';
  shell.dataset.creativeMode = mode;
  if (title) title.textContent = mode === 'video' ? 'Prometheus Video Studio' : 'Prometheus Image Studio';
  if (subtitle) subtitle.textContent = mode === 'video'
    ? 'Build HTML Motion, HyperFrames, and Remotion clips with deterministic frame QA.'
    : 'Build still compositions on a focused studio canvas with the shared scene graph underneath.';

  const selected = context.getSelectedCreativeElement();
  const selectedContext = selected ? context.buildSceneSelectionContext(context.creativeSceneDoc, selected.id) : null;
  const selectedRendered = selected ? context.getRenderedCreativeElement(selected, mode) : null;
  const propertyElement = mode === 'video' && selectedRendered ? { ...selected, ...selectedRendered } : selected;
  const libraryPackCatalog = context.getCreativeLibraryPackCatalogState();
  const filteredLibrary = context.getFilteredCreativeLibrarySections();
  const libraryFilterOptions = libraryPackCatalog
    .filter((pack) => context.getActiveCreativeLibraryIds().includes(String(pack?.id || '').trim().toLowerCase()))
    .map((pack) => ({ id: String(pack.id), label: pack.label || pack.id, source: pack.source || 'builtin' }));

  const _libNavTabs = [
    ...(mode === 'video' ? [] : [
      { id: 'elements', icon: 'solar:layers-minimalistic-bold-duotone', label: 'Elements' },
    ]),
    ...(mode === 'video' ? [{ id: 'blocks', icon: 'solar:widget-add-bold-duotone', label: 'Blocks' }] : []),
    { id: 'icons', icon: 'solar:sticker-smile-circle-2-bold-duotone', label: 'Icons' },
    { id: 'libraries', icon: 'solar:widget-add-bold-duotone', label: 'Packs' },
  ];
  const _libNavStrip = `
    <nav class="creative-lib-nav">
      ${_libNavTabs.map((t) => `
        <button class="creative-lib-nav-btn${context.creativeLibraryNavTab === t.id ? ' active' : ''}"
                onclick="canvasSetCreativeLibraryNavTab('${t.id}')"
                title="${t.label}">
          <iconify-icon icon="${t.icon}" width="20" height="20"></iconify-icon>
          <span>${t.label}</span>
        </button>
      `).join('')}
    </nav>
  `;

  // Elements panel — category grid or expanded items
  const _elementCategories = [
    { id: 'text', label: 'Text', icon: 'solar:text-bold-duotone' },
    { id: 'shapes', label: 'Shapes', icon: 'solar:shapes-bold-duotone' },
    { id: 'icons', label: 'Icons', icon: 'solar:stars-bold-duotone' },
    { id: 'images', label: 'Images', icon: 'solar:gallery-wide-bold-duotone' },
    { id: 'components', label: 'Components', icon: 'solar:widget-4-bold-duotone' },
    { id: 'animations', label: 'Lottie', icon: 'solar:film-roll-bold-duotone' },
  ];
  const _allSections = filteredLibrary.sections.reduce((acc, s) => { acc[s.section.toLowerCase()] = s.items; return acc; }, {});
  const _activeLibraryCat = context.creativeLibraryActiveCategory;
  const _libPanelElements = _activeLibraryCat
    ? (() => {
        const catData = _elementCategories.find((c) => c.id === _activeLibraryCat);
        const items = _allSections[_activeLibraryCat] || [];
        return `
          <div class="creative-lib-panel-header">
            <button class="creative-lib-cat-back" onclick="canvasSetCreativeLibraryCategory(null)">
              <iconify-icon icon="solar:arrow-left-bold-duotone" width="14" height="14"></iconify-icon>
              ${catData ? catData.label : _activeLibraryCat}
            </button>
          </div>
          <div class="creative-lib-cat-items">
            ${items.length ? items.map((item) => `
              <button onclick="canvasAddCreativeLibraryItem('${context.escHtml(_activeLibraryCat)}','${context.escHtml(item.kind)}')" class="creative-lib-tile">
                <span class="creative-lib-tile-icon"><iconify-icon icon="${context.escHtml(context.getCreativeLibraryItemIconStudioV3(_activeLibraryCat, item))}" width="22" height="22"></iconify-icon></span>
                <span class="creative-lib-tile-label">${context.escHtml(item.label)}</span>
              </button>
            `).join('') : `<div class="creative-asset-empty" style="padding:16px">No items in this category. Install a library pack to add more.</div>`}
          </div>
        `;
      })()
    : `
      <div class="creative-lib-panel-header">
        <div class="creative-lib-panel-title">Elements</div>
        <div class="creative-lib-panel-sub">Click a category to add to canvas.</div>
      </div>
      <div class="creative-lib-cat-grid">
        ${_elementCategories.map((cat) => `
          <button class="creative-lib-cat-btn" onclick="canvasSetCreativeLibraryCategory('${cat.id}')">
            <iconify-icon icon="${cat.icon}" width="24" height="24"></iconify-icon>
            <span>${cat.label}</span>
          </button>
        `).join('')}
      </div>
      <div style="padding:10px 12px 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Quick add</div>
        <div class="creative-lib-cat-items" style="grid-template-columns:repeat(2,1fr)">
          ${(filteredLibrary.sections.slice(0,1).flatMap((s) => s.items.slice(0,4))).map((item) => `
            <button onclick="canvasAddCreativeLibraryItem('${context.escHtml(filteredLibrary.sections[0]?.section || 'text')}','${context.escHtml(item.kind)}')" class="creative-lib-tile">
              <span class="creative-lib-tile-icon"><iconify-icon icon="${context.escHtml(context.getCreativeLibraryItemIconStudioV3(filteredLibrary.sections[0]?.section || 'text', item))}" width="18" height="18"></iconify-icon></span>
              <span class="creative-lib-tile-label">${context.escHtml(item.label)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

  // Iconify search panel
  const _iconifyQuery = context.escHtml(context.creativeIconifySearch.query || '');
  const _libPanelIconify = `
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
          value="${_iconifyQuery}"
          oninput="canvasSearchIconify(this.value)"
          style="flex:1;min-width:0"
        />
      </div>
    </div>
    ${context.creativeIconifySearch.loading ? `<div class="creative-asset-empty" style="padding:16px">Searching...</div>` : ''}
    ${context.creativeIconifySearch.error ? `<div class="creative-asset-empty" style="padding:16px;color:#fca5a5">${context.escHtml(context.creativeIconifySearch.error)}</div>` : ''}
    ${!context.creativeIconifySearch.loading && context.creativeIconifySearch.results.length ? `
      <div class="creative-iconify-grid">
        ${context.creativeIconifySearch.results.map((iconName) => `
          <button class="creative-iconify-tile" onclick="canvasAddIconifyIcon('${context.escHtml(iconName)}')" title="${context.escHtml(iconName)}">
            <iconify-icon icon="${context.escHtml(iconName)}" width="24" height="24"></iconify-icon>
          </button>
        `).join('')}
      </div>
    ` : (!context.creativeIconifySearch.loading && !context.creativeIconifySearch.query ? `
      <div style="padding:12px 12px 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Popular sets</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${[['Solar', 'solar:stars-bold-duotone','solar:'],['Material','mdi:material-design','mdi:'],['Phosphor','ph:star-duotone','ph:'],['Tabler','tabler:star','tabler:'],['Heroicons','heroicons:star-solid','heroicons:'],['Lucide','lucide:star','lucide:']].map(([label, icon, prefix]) => `
            <button class="creative-lib-cat-back" style="justify-content:flex-start;gap:8px;padding:7px 8px" onclick="canvasSearchIconify('${prefix}')">
              <iconify-icon icon="${context.escHtml(icon)}" width="16" height="16" style="color:#fb923c"></iconify-icon>
              <span style="font-size:11px;font-weight:600;color:#d6d3d1">${context.escHtml(label)}</span>
              <span style="font-size:10px;color:#6b7280;margin-left:auto">${context.escHtml(prefix)}*</span>
            </button>
          `).join('')}
        </div>
      </div>
    ` : '')}
  `;

  const _libPanelLibraries = `
    <div class="creative-lib-panel-header">
      <div class="creative-lib-panel-title">Library Packs</div>
      <div class="creative-lib-panel-sub">Install icon sets, shapes &amp; motion presets.</div>
    </div>
    ${context.renderCreativeLibraryPacksStudioV3()}
  `;

  const _libPanelHtmlMotionBlocks = mode === 'video' ? `
    <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06)">
      <button type="button" class="creative-chip-btn creative-chip-btn--accent" onclick="canvasOpenHyperframesCatalog()" style="width:100%;justify-content:center">
        <iconify-icon icon="solar:widget-add-bold-duotone" width="14" height="14"></iconify-icon>
        HyperFrames Catalog
      </button>
    </div>
    ${context.renderCreativeHtmlMotionBlocksPanelStudioV3()}
  ` : '';

  // Typography panel takes over the library when a text element is selected.
  const _libPanelTypography = (selected && selected.type === 'text') ? `
    <div class="creative-lib-panel-header">
      <div class="creative-lib-panel-title">Typography</div>
      <div class="creative-lib-panel-sub">Editing the selected text layer.</div>
    </div>
    <div style="padding:12px">
      ${context.renderCreativePropertyTextareaStudioV3('Content', 'meta.content', selected.meta?.content || '')}
      <div class="creative-field-grid" style="margin-top:12px">
        ${context.renderCreativePropertyFieldStudioV3('Font size', 'meta.fontSize', selected.meta?.fontSize || 24)}
        ${context.renderCreativePropertyFieldStudioV3('Weight', 'meta.fontWeight', selected.meta?.fontWeight || 700)}
        ${context.renderCreativePropertyFieldStudioV3('Font family', 'meta.fontFamily', selected.meta?.fontFamily || 'Manrope', 'text')}
        <label class="creative-form-field">
          <span class="creative-form-label">Align</span>
          <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.textAlign', this.value, 'text')">
            ${['left', 'center', 'right'].map((align) => `<option value="${align}" ${String(selected.meta?.textAlign || 'left') === align ? 'selected' : ''}>${align}</option>`).join('')}
          </select>
        </label>
        ${context.renderCreativePropertyFieldStudioV3('Line height', 'meta.lineHeight', selected.meta?.lineHeight || 1.2, 'number', { step: '0.1' })}
        ${context.renderCreativePropertyFieldStudioV3('Letter spacing', 'meta.letterSpacing', selected.meta?.letterSpacing || 0, 'number', { step: '0.5' })}
        ${context.renderCreativePropertyFieldStudioV3('Color', 'meta.color', selected.meta?.color || '#111827', 'color')}
      </div>
    </div>
  ` : '';

  const _libCollapsed = !context.creativeLibraryNavTab && !_libPanelTypography;
  shell.classList.toggle('is-library-collapsed', _libCollapsed);
  let _libPanelInner;
  if (_libPanelTypography) _libPanelInner = _libPanelTypography;
  else if (context.creativeLibraryNavTab === 'icons') _libPanelInner = _libPanelIconify;
  else if (context.creativeLibraryNavTab === 'libraries') _libPanelInner = _libPanelLibraries;
  else if (context.creativeLibraryNavTab === 'blocks') _libPanelInner = _libPanelHtmlMotionBlocks;
  else if (context.creativeLibraryNavTab === 'elements') _libPanelInner = _libPanelElements;
  else _libPanelInner = '';
  library.innerHTML = `
    ${_libNavStrip}
    ${_libPanelInner ? `<div class="creative-lib-panel">${_libPanelInner}</div>` : ''}
  `;
  library.style.minWidth = '0';

  const audioTrack = context.getCreativeAudioTrackConfig();
  const hasAudioTrack = context.hasCreativeAudioTrack();
  const audioLabel = audioTrack.label || (audioTrack.source ? String(audioTrack.source).split('/').pop() : 'No track loaded');

  stage.style.width = `${context.creativeSceneDoc.width}px`;
  stage.style.height = `${context.creativeSceneDoc.height}px`;
  stage.style.background = context.creativeSceneDoc.background || '#ffffff';
  stage.style.maxWidth = 'none';
  stage.style.flex = '0 0 auto';
  if (!skipStageRender) context.renderCreativeStageStudioV3(stage, mode);
  else context.syncCreativeFabricSelectionFromState({ render: true });

  const stageWrap = document.getElementById('canvas-creative-stage-wrap');
  const stageCaption = document.getElementById('canvas-creative-stage-caption');
  const stageStatus = document.getElementById('canvas-creative-stage-status');
  const stageSize = document.getElementById('canvas-creative-stage-size');
  const stageFooter = document.getElementById('canvas-creative-stage-footer');
  const stageScroll = document.getElementById('canvas-creative-stage-scroll');
  const stageLiveStatus = document.getElementById('canvas-creative-stage-live-status');
  const stageZoomLabel = document.getElementById('canvas-creative-stage-zoom');
  const toolbarGifBtn = document.getElementById('canvas-creative-export-gif-btn');
  const toolbarMp4Btn = document.getElementById('canvas-creative-export-mp4-btn');
  const toolbarWebmBtn = document.getElementById('canvas-creative-export-webm-btn');
  const toolbarCancelBtn = document.getElementById('canvas-creative-export-cancel-btn');
  const exportPercent = context.getCreativeActiveExportPercent();
  const exportStatus = String(context.creativeActiveExport?.status || '').trim().toLowerCase();
  if (stageWrap) {
    stageWrap.style.minWidth = '0';
    stageWrap.style.position = 'relative';
    stageWrap.style.isolation = 'isolate';
  }
  if (stageCaption) {
    stageCaption.textContent = context.creativeHtmlMotionClip
      ? 'HTML/CSS motion clip preview. Use sampled frame QA before MP4 export.'
      : mode === 'video'
      ? 'Motion-ready frame with timeline-aware editing at the current playhead.'
      : 'Framed composition surface for posters, social assets, and export-ready stills.';
  }
  if (stageStatus) stageStatus.style.display = 'none';
  if (stageSize) stageSize.style.display = 'none';
  if (stageLiveStatus) stageLiveStatus.textContent = context.isCreativeExportActive()
    ? `${String(context.creativeActiveExport?.format || 'export').toUpperCase()} ${exportPercent}%`
    : (context.creativeHtmlMotionClip ? 'HTML motion' : (mode === 'video' ? 'Timeline live' : 'Live canvas'));
  if (stageZoomLabel) stageZoomLabel.textContent = `${Math.round(context.clampCreativeStageZoom(context.creativeStageZoom) * 100)}%`;
  const renderExportMenuItem = (iconName, label, hint) => `<iconify-icon icon="${iconName}" width="16" height="16"></iconify-icon><span>${context.escHtml(label)}</span><span class="creative-export-menu-hint">${context.escHtml(hint)}</span>`;
  if (toolbarGifBtn) {
    const showGif = mode === 'video' && !!context.getCreativeGifExportConfig();
    const isGifExporting = context.isCreativeExportActive('gif');
    toolbarGifBtn.style.display = showGif ? 'grid' : 'none';
    toolbarGifBtn.disabled = context.isCreativeExportActive();
    if (showGif) toolbarGifBtn.innerHTML = renderExportMenuItem('solar:gallery-favourite-bold-duotone', isGifExporting ? `GIF ${exportPercent}%` : 'GIF', 'Animation');
  }
  if (toolbarMp4Btn) {
    const mp4Config = context.getCreativeVideoExportConfig('mp4');
    const showMp4 = mode === 'video' && !!mp4Config;
    const isMp4Exporting = context.isCreativeExportActive('mp4');
    toolbarMp4Btn.style.display = showMp4 ? 'grid' : 'none';
    toolbarMp4Btn.disabled = context.isCreativeExportActive();
    if (showMp4) toolbarMp4Btn.innerHTML = renderExportMenuItem('solar:videocamera-record-bold-duotone', isMp4Exporting ? `MP4 ${exportPercent}%` : 'MP4', 'Video');
  }
  if (toolbarWebmBtn) {
    const showWebm = mode === 'video';
    const isWebmExporting = context.isCreativeExportActive('webm');
    toolbarWebmBtn.style.display = showWebm ? 'grid' : 'none';
    toolbarWebmBtn.disabled = context.isCreativeExportActive();
    if (showWebm) toolbarWebmBtn.innerHTML = renderExportMenuItem('solar:clapperboard-play-bold-duotone', isWebmExporting ? `WEBM ${exportPercent}%` : 'WEBM', 'Video');
  }
  if (toolbarCancelBtn) {
    const showCancel = mode === 'video' && context.isCreativeExportActive();
    toolbarCancelBtn.style.display = showCancel ? 'grid' : 'none';
    toolbarCancelBtn.disabled = context.creativeActiveExport?.cancelRequested === true;
    if (showCancel) toolbarCancelBtn.innerHTML = renderExportMenuItem('solar:close-circle-bold-duotone', context.creativeActiveExport?.cancelRequested ? 'Stopping...' : 'Cancel export', '');
  }
  if (stageFooter) {
    stageFooter.textContent = context.isCreativeExportActive('gif')
      ? (context.creativeActiveExport?.cancelRequested
        ? 'Stopping the GIF export now. The current frame or encoder step will finish and then your edit state will be restored.'
        : `Rendering the animated GIF now. ${exportStatus === 'encoding' ? 'Encoding frames into GIF.' : exportStatus === 'capturing' ? 'Capturing timeline frames.' : 'Finalizing the file now.'} Progress ${exportPercent}%.`)
      : context.isCreativeExportActive('webm')
      ? (context.creativeActiveExport?.cancelRequested
        ? 'Stopping the WebM export now. The current frame pass will finish and then your edit state will be restored.'
        : `${context.creativeActiveExport?.audioEnabled ? 'Recording audio + video to WebM now.' : (context.creativeActiveExport?.audioRequested ? 'Recording video to WebM now. The audio lane could not be attached in this browser, so this export is silent.' : 'Recording the full video draft to WebM now.')} ${exportStatus === 'finalizing' ? 'Finalizing the file now.' : `Progress ${exportPercent}%.`}`)
      : context.isCreativeExportActive('mp4')
        ? (context.creativeActiveExport?.cancelRequested
          ? 'Stopping the MP4 export now. The current frame pass will finish and then your edit state will be restored.'
          : `${context.creativeActiveExport?.audioEnabled ? 'Recording audio + video to MP4 now.' : (context.creativeActiveExport?.audioRequested ? 'Recording video to MP4 now. The audio lane could not be attached in this browser, so this export is silent.' : 'Recording the full video draft to MP4 now.')} ${exportStatus === 'finalizing' ? 'Finalizing the file now.' : `Progress ${exportPercent}%.`}`)
        : selected
          ? `${selected.type} selected. Drag on the frame or use the corner handle for quick edits.`
          : mode === 'video'
          ? (hasAudioTrack ? 'Move or resize elements at the playhead to create keyframes while the audio lane stays aligned underneath.' : 'Move or resize elements at the playhead to create animation keyframes on the frame.')
          : 'Select an element to style it or pull new pieces from the studio rail.';
  }

  props.style.minWidth = '0';
  props.style.overflowX = 'hidden';
  props.style.overflowY = 'auto';
  const renderedX = Math.round(Number(propertyElement?.x ?? selected?.x ?? 0) || 0);
  const renderedY = Math.round(Number(propertyElement?.y ?? selected?.y ?? 0) || 0);
  const renderedWidth = Math.round(Number(propertyElement?.width ?? selected?.width ?? 0) || 0);
  const renderedHeight = Math.round(Number(propertyElement?.height ?? selected?.height ?? 0) || 0);
  const inspectorTabs = context.renderCreativeInspectorTabsStudioV3();
  const audioCard = mode === 'video' ? `
    <section class="creative-inspector-card">
      <div class="creative-section-heading">
        <div class="creative-card-title">Audio lane</div>
        <div class="creative-card-subtitle">Attach a soundtrack or VO file now so timing lives with the scene document before the full audio engine lands.</div>
      </div>
      ${context.renderCreativePropertyFieldStudioV3('Audio source', 'audioTrack.source', audioTrack.source || '', 'text', { handler: 'canvasUpdateCreativeDocumentProperty' })}
      <div class="creative-field-grid" style="margin-top:12px">
        ${context.renderCreativePropertyFieldStudioV3('Label', 'audioTrack.label', audioTrack.label || '', 'text', { handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Start (ms)', 'audioTrack.startMs', audioTrack.startMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Duration (ms)', 'audioTrack.durationMs', audioTrack.durationMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Volume', 'audioTrack.volume', audioTrack.volume ?? 1, 'number', { min: '0', max: '1', step: '0.05', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyToggleStudioV3('Muted', 'audioTrack.muted', audioTrack.muted === true, { handler: 'canvasUpdateCreativeDocumentProperty' })}
      </div>
      <div class="creative-section-heading" style="margin-top:16px">
        <div class="creative-card-title">Trim &amp; fade</div>
        <div class="creative-card-subtitle">Clip the source file and shape the volume envelope. These values feed directly into the audio engine timing.</div>
      </div>
      <div class="creative-field-grid">
        ${context.renderCreativePropertyFieldStudioV3('Trim start (ms)', 'audioTrack.trimStartMs', audioTrack.trimStartMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Trim end (ms)', 'audioTrack.trimEndMs', audioTrack.trimEndMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Fade in (ms)', 'audioTrack.fadeInMs', audioTrack.fadeInMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
        ${context.renderCreativePropertyFieldStudioV3('Fade out (ms)', 'audioTrack.fadeOutMs', audioTrack.fadeOutMs || 0, 'number', { min: '0', step: '50', handler: 'canvasUpdateCreativeDocumentProperty' })}
      </div>
      ${audioTrack.analysis?.durationMs ? `<div class="creative-info-note" style="margin-top:10px">Source duration: ${context.escHtml(context.formatCreativeTimelineTime(audioTrack.analysis.durationMs))}${audioTrack.analysis?.codec ? ` · ${context.escHtml(audioTrack.analysis.codec)}` : ''}${audioTrack.analysis?.sampleRate ? ` · ${Math.round(audioTrack.analysis.sampleRate / 1000)}kHz` : ''}</div>` : ''}
      <div class="creative-info-note">${context.escHtml(hasAudioTrack ? `Current lane: ${audioLabel}` : 'Drop in a path or URL now and the lane will show up in the timeline immediately.')}</div>
      <div class="creative-pill-row" style="margin-top:12px">
        <button onclick="canvasClearCreativeAudioTrack()" class="creative-chip-btn">Clear audio</button>
      </div>
    </section>
  ` : '';

  if (context.creativeInspectorTab === 'layers') {
    props.innerHTML = `
      ${inspectorTabs}
      ${context.renderCreativeLayersPanelStudioV3(mode)}
    `;
  } else if (selected) {
    const selectionSummary = `
      <div class="creative-inspector-summary">
        <span class="creative-summary-pill">x ${renderedX}</span>
        <span class="creative-summary-pill">y ${renderedY}</span>
        <span class="creative-summary-pill">${renderedWidth} x ${renderedHeight}</span>
        <span class="creative-summary-pill">opacity ${Number(propertyElement?.opacity ?? selected.opacity ?? 1).toFixed(2)}</span>
        ${context.getCreativeAspectLockEnabled(selected) ? `<span class="creative-summary-pill">aspect locked</span>` : ''}
        ${mode === 'video' ? `<span class="creative-summary-pill">${Array.isArray(selected.meta?.keyframes) ? selected.meta.keyframes.length : 0} keyframes</span>` : ''}
      </div>
    `;

    const transformCard = `
      <section class="creative-inspector-card">
        <div class="creative-section-heading">
          <div class="creative-card-title">Transform</div>
          <div class="creative-card-subtitle">Position, sizing, and layer visibility for the selected element.</div>
        </div>
        <div class="creative-field-grid">
          ${context.renderCreativePropertyFieldStudioV3('X', 'x', propertyElement?.x ?? selected.x)}
          ${context.renderCreativePropertyFieldStudioV3('Y', 'y', propertyElement?.y ?? selected.y)}
          ${context.renderCreativePropertyFieldStudioV3('Width', 'width', propertyElement?.width ?? selected.width)}
          ${context.renderCreativePropertyFieldStudioV3('Height', 'height', propertyElement?.height ?? selected.height)}
          ${context.renderCreativePropertyFieldStudioV3('Rotation', 'rotation', propertyElement?.rotation ?? selected.rotation)}
          ${context.renderCreativePropertyFieldStudioV3('Opacity', 'opacity', propertyElement?.opacity ?? selected.opacity, 'number', { step: '0.1', min: '0', max: '1' })}
          ${context.renderCreativePropertyFieldStudioV3('Z index', 'zIndex', selected.zIndex)}
          ${context.renderCreativePropertyToggleStudioV3('Aspect lock', 'meta.aspectLocked', context.getCreativeAspectLockEnabled(selected))}
          ${context.renderCreativePropertyToggleStudioV3('Visible', 'visible', selected.visible !== false)}
          ${context.renderCreativePropertyToggleStudioV3('Locked', 'locked', selected.locked === true)}
        </div>
      </section>
    `;

    let typeSpecificCard = '';
    if (selected.type === 'text') {
      typeSpecificCard = `
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Typography</div>
            <div class="creative-card-subtitle">Content, type settings, and measured layout data for this text layer.</div>
          </div>
          ${context.renderCreativePropertyTextareaStudioV3('Content', 'meta.content', selected.meta?.content || '')}
          <div class="creative-field-grid" style="margin-top:12px">
            ${context.renderCreativePropertyFieldStudioV3('Font size', 'meta.fontSize', selected.meta?.fontSize || 24)}
            ${context.renderCreativePropertyFieldStudioV3('Weight', 'meta.fontWeight', selected.meta?.fontWeight || 700)}
            ${context.renderCreativePropertyFieldStudioV3('Font family', 'meta.fontFamily', selected.meta?.fontFamily || 'Manrope', 'text')}
            <label class="creative-form-field">
              <span class="creative-form-label">Align</span>
              <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.textAlign', this.value, 'text')">
                ${['left', 'center', 'right'].map((align) => `<option value="${align}" ${String(selected.meta?.textAlign || 'left') === align ? 'selected' : ''}>${align}</option>`).join('')}
              </select>
            </label>
            ${context.renderCreativePropertyFieldStudioV3('Line height', 'meta.lineHeight', selected.meta?.lineHeight || 1.2, 'number', { step: '0.1' })}
            ${context.renderCreativePropertyFieldStudioV3('Letter spacing', 'meta.letterSpacing', selected.meta?.letterSpacing || 0, 'number', { step: '0.5' })}
            ${context.renderCreativePropertyFieldStudioV3('Color', 'meta.color', selected.meta?.color || '#111827', 'color')}
          </div>
          <div class="creative-info-note">
            <div><strong>Measurement:</strong> ${context.escHtml(selected.meta?.pretextMeasured ? 'Pretext' : (selected.meta?.measurement?.kind || 'fallback'))}</div>
            <div><strong>Lines:</strong> ${context.escHtml(String(selected.meta?.measurement?.lineCount || 1))} | <strong>Height:</strong> ${context.escHtml(String(Math.round(Number(selected.meta?.measurement?.height || selected.height || 0))))} px</div>
          </div>
        </section>
      `;
    } else if (selected.type === 'shape') {
      typeSpecificCard = `
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Shape styling</div>
            <div class="creative-card-subtitle">Update geometry, fill, stroke, and corner treatment for the selected shape.</div>
          </div>
          <div class="creative-field-grid">
            <label class="creative-form-field">
              <span class="creative-form-label">Shape</span>
              <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.shape', this.value, 'text')">
                ${['rect', 'circle', 'triangle', 'polygon', 'line', 'arrow'].map((shapeOption) => `<option value="${shapeOption}" ${String(selected.meta?.shape || 'rect') === shapeOption ? 'selected' : ''}>${shapeOption}</option>`).join('')}
              </select>
            </label>
            ${context.renderCreativePropertyFieldStudioV3('Fill', 'meta.fill', selected.meta?.fill || '#111827', 'color')}
            ${context.renderCreativePropertyFieldStudioV3('Stroke', 'meta.stroke', selected.meta?.stroke || '#111827', 'color')}
            ${context.renderCreativePropertyFieldStudioV3('Radius', 'meta.radius', selected.meta?.radius || 0)}
            ${context.renderCreativePropertyFieldStudioV3('Stroke width', 'meta.strokeWidth', selected.meta?.strokeWidth || 0)}
            ${String(selected.meta?.shape || 'rect') === 'polygon' ? context.renderCreativePropertyFieldStudioV3('Sides', 'meta.sides', selected.meta?.sides || 6, 'number', { min: '5', max: '8', step: '1' }) : ''}
          </div>
        </section>
      `;
    } else if (selected.type === 'icon') {
      typeSpecificCard = `
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Icon</div>
            <div class="creative-card-subtitle">Swap the icon name or recolor the current glyph.</div>
          </div>
          ${context.renderCreativePropertyFieldStudioV3('Icon name', 'meta.iconName', selected.meta?.iconName || 'solar:stars-bold-duotone', 'text')}
          <div class="creative-field-grid" style="margin-top:12px">
            ${context.renderCreativePropertyFieldStudioV3('Color', 'meta.color', selected.meta?.color || '#111827', 'color')}
          </div>
        </section>
      `;
      } else if (selected.type === 'image' || selected.type === 'video') {
        typeSpecificCard = `
          <section class="creative-inspector-card">
            <div class="creative-section-heading">
              <div class="creative-card-title">${selected.type === 'video' ? 'Video layer' : 'Image layer'}</div>
              <div class="creative-card-subtitle">Control source, fit mode, frame radius, and asset timing for the selected media block.</div>
            </div>
            ${context.renderCreativePropertyFieldStudioV3('Source', 'meta.source', selected.meta?.source || '', 'text')}
            ${selected.type === 'image' ? `<div class="creative-pill-row" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="creative-chip-btn creative-chip-btn--accent" onclick="canvasOpenExtractLayersDialog(${context.encodeInlineJsString(selected.meta?.source || '')})" ${context.creativeLayerExtractionBusy || !selected.meta?.source ? 'disabled' : ''}>
                <iconify-icon icon="solar:layers-bold-duotone" width="14" height="14"></iconify-icon>${context.escHtml(context.creativeLayerExtractionBusy ? 'Extracting...' : 'Extract layers')}
              </button>
              ${(selected.meta?.extraction?.samCutout || selected.meta?.extraction?.cutoutBbox) ? `<button type="button" class="creative-chip-btn" onclick="canvasStartRefineSelectedMask()" title="Click in the layer to keep, shift-click to remove, Enter to apply">
                <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14" height="14"></iconify-icon>Refine mask
              </button>` : ''}
            </div>` : ''}
            <div class="creative-field-grid" style="margin-top:12px">
              ${context.renderCreativePropertyFieldStudioV3('Fit', 'meta.fit', selected.meta?.fit || 'cover', 'text')}
              ${context.renderCreativePropertyFieldStudioV3('Radius', 'meta.radius', selected.meta?.radius || 18)}
            </div>
            ${selected.type === 'video' ? `<div class="creative-field-grid" style="margin-top:12px">
              ${context.renderCreativePropertyFieldStudioV3('Start Ms', 'meta.timelineStartMs', selected.meta?.timelineStartMs || 0)}
              ${context.renderCreativePropertyFieldStudioV3('Duration Ms', 'meta.timelineDurationMs', selected.meta?.timelineDurationMs || context.creativeSceneDoc.durationMs)}
              ${context.renderCreativePropertyFieldStudioV3('Trim Start', 'meta.trimStartMs', selected.meta?.trimStartMs || 0)}
              ${context.renderCreativePropertyFieldStudioV3('Volume', 'meta.volume', selected.meta?.volume || 0, 'number', { step: '0.05', min: '0', max: '1' })}
            </div>` : ''}
          </section>
        `;
    } else if (selected.type === 'group') {
      typeSpecificCard = `
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Component</div>
            <div class="creative-card-subtitle">Starter component metadata for the selected grouped element.</div>
          </div>
          <label class="creative-form-field">
            <span class="creative-form-label">Component</span>
            <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.component', this.value, 'text')">
              ${['card', 'button', 'badge', 'divider', 'stat', 'quote'].map((componentName) => `<option value="${componentName}" ${String(selected.meta?.component || 'card') === componentName ? 'selected' : ''}>${componentName}</option>`).join('')}
            </select>
          </label>
          <div class="creative-field-grid" style="margin-top:12px">
            ${context.renderCreativePropertyFieldStudioV3('Background', 'meta.background', selected.meta?.background || '#111827', 'color')}
            ${context.renderCreativePropertyFieldStudioV3('Text color', 'meta.textColor', selected.meta?.textColor || '#f8fafc', 'color')}
            ${context.renderCreativePropertyFieldStudioV3('Accent', 'meta.accent', selected.meta?.accent || '#f97316', 'color')}
            ${context.renderCreativePropertyFieldStudioV3('Radius', 'meta.radius', selected.meta?.radius || 18)}
          </div>
          ${['card'].includes(String(selected.meta?.component || 'card')) ? context.renderCreativePropertyFieldStudioV3('Title', 'meta.title', selected.meta?.title || 'Feature card', 'text') : ''}
          ${['card'].includes(String(selected.meta?.component || 'card')) ? context.renderCreativePropertyTextareaStudioV3('Body', 'meta.body', selected.meta?.body || 'Use starter components to block in polished layouts quickly.') : ''}
          ${['button', 'badge', 'divider', 'stat'].includes(String(selected.meta?.component || 'card')) ? context.renderCreativePropertyFieldStudioV3('Label', 'meta.label', selected.meta?.label || 'Label', 'text') : ''}
          ${String(selected.meta?.component || 'card') === 'stat' ? context.renderCreativePropertyFieldStudioV3('Value', 'meta.value', selected.meta?.value || '24%', 'text') : ''}
          ${String(selected.meta?.component || 'card') === 'quote' ? context.renderCreativePropertyTextareaStudioV3('Quote', 'meta.quote', selected.meta?.quote || 'Design the system, then let it move.') : ''}
          ${String(selected.meta?.component || 'card') === 'quote' ? context.renderCreativePropertyFieldStudioV3('Author', 'meta.author', selected.meta?.author || 'Prometheus', 'text') : ''}
        </section>
      `;
    } else if (selected.type === 'hyperframes') {
      typeSpecificCard = context.renderHyperframesInspector(selected);
    } else if (selected.type === 'lottie') {
      typeSpecificCard = `
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Lottie Animation</div>
            <div class="creative-card-subtitle">Paste a LottieFiles URL or any .json animation URL. Find free animations at lottiefiles.com.</div>
          </div>
          ${context.renderCreativePropertyFieldStudioV3('Source URL', 'meta.source', selected.meta?.source || '', 'text')}
          <div class="creative-field-grid" style="margin-top:12px">
            ${context.renderCreativePropertyFieldStudioV3('Speed', 'meta.speed', selected.meta?.speed ?? 1, 'number', { step: '0.1', min: '0.1', max: '4' })}
            ${context.renderCreativePropertyToggleStudioV3('Loop', 'meta.loop', selected.meta?.loop !== false)}
            ${context.renderCreativePropertyToggleStudioV3('Autoplay', 'meta.autoplay', selected.meta?.autoplay !== false)}
          </div>
          <div class="creative-info-note">Browse 50,000+ free animations at <strong>lottiefiles.com</strong> — copy the Lottie JSON URL and paste above.</div>
        </section>
      `;
    }

    const actionCard = `
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
    `;

    const focusCard = '';

    props.innerHTML = `
      ${inspectorTabs}
      <div class="creative-inspector-body">
        <section class="creative-inspector-card creative-inspector-card--hero">
          <div class="creative-inspector-card-header">
            <div>
              <div class="creative-inspector-kicker">Selected layer</div>
              <div class="creative-inspector-card-title">${context.escHtml(selected.type)}</div>
              <div class="creative-inspector-subtext">${context.escHtml(selected.id)}</div>
            </div>
            <div class="creative-inspector-badge">${mode === 'video' ? 'Timeline linked' : 'Live frame'}</div>
          </div>
          ${selectionSummary}
        </section>
        ${mode === 'video' ? context.renderCreativeHtmlMotionLintCardStudioV3() : ''}
        ${actionCard}
        ${selected.type === 'text' ? '' : typeSpecificCard}
        ${selected.type === 'text' ? '' : transformCard}
        ${mode === 'video' ? context.renderCreativeKeyframeSectionStudioV3(selected) : ''}
        ${audioCard}
        ${context.renderCreativeQuickExportCardStudioV3()}
        ${context.renderCreativeSavedAssetsCardStudioV3()}
        ${focusCard}
      </div>
    `;
  } else {
    props.innerHTML = `
      ${inspectorTabs}
      <div class="creative-inspector-body">
        <section class="creative-inspector-card creative-inspector-card--hero">
          <div class="creative-inspector-card-header">
            <div>
              <div class="creative-inspector-kicker">Scene</div>
              <div class="creative-inspector-card-title">${context.escHtml(mode === 'video' ? 'Motion workspace' : 'Image workspace')}</div>
              <div class="creative-inspector-subtext">No element is selected yet. Tune the frame, choose a preset, or pull pieces in from the studio rail.</div>
            </div>
            <div class="creative-inspector-badge">${context.creativeSceneDoc.elements.length} elements</div>
          </div>
          <div class="creative-inspector-summary">
            <span class="creative-summary-pill">${context.creativeSceneDoc.width} x ${context.creativeSceneDoc.height}</span>
            <span class="creative-summary-pill">${context.escHtml(mode === 'video' ? 'Timeline enabled' : 'Still frame')}</span>
            <span class="creative-summary-pill">${context.escHtml(context.creativeSceneDoc.background || '#ffffff')}</span>
          </div>
        </section>
        ${mode === 'video' ? context.renderCreativeHtmlMotionLintCardStudioV3() : ''}
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Canvas setup</div>
            <div class="creative-card-subtitle">Choose a frame size and update the scene document properties directly.</div>
          </div>
          <label class="creative-form-field" style="margin-bottom:12px">
            <span class="creative-form-label">Canvas preset</span>
            <select class="creative-form-select" onchange="canvasApplyCreativeSizePreset(this.value)">
              <option value="">Choose a preset...</option>
              ${Object.entries(context.CREATIVE_SIZE_PRESETS).map(([presetKey, preset]) => `
                <option value="${context.escHtml(presetKey)}">${context.escHtml(`${preset.label} | ${preset.width} x ${preset.height}`)}</option>
              `).join('')}
            </select>
          </label>
          <div class="creative-field-grid">
            ${context.renderCreativePropertyFieldStudioV3('Canvas width', 'width', context.creativeSceneDoc.width, 'number', { handler: 'canvasUpdateCreativeDocumentProperty' })}
            ${context.renderCreativePropertyFieldStudioV3('Canvas height', 'height', context.creativeSceneDoc.height, 'number', { handler: 'canvasUpdateCreativeDocumentProperty' })}
            ${context.renderCreativePropertyFieldStudioV3('Background', 'background', context.creativeSceneDoc.background || '#ffffff', 'color', { handler: 'canvasUpdateCreativeDocumentProperty' })}
            ${mode === 'video' ? context.renderCreativePropertyFieldStudioV3('Duration (ms)', 'durationMs', context.creativeSceneDoc.durationMs || 12000, 'number', { min: '1000', step: '250', handler: 'canvasUpdateCreativeDocumentProperty' }) : ''}
            ${mode === 'video' ? context.renderCreativePropertyFieldStudioV3('Frame rate', 'frameRate', context.creativeSceneDoc.frameRate || 60, 'number', { min: '60', step: '1', handler: 'canvasUpdateCreativeDocumentProperty' }) : ''}
          </div>
        </section>
        ${mode === 'video' ? `
          <section class="creative-inspector-card">
            <div class="creative-section-heading">
              <div class="creative-card-title">Playback</div>
              <div class="creative-card-subtitle">Scrub the current draft and preview the motion timing from the inspector.</div>
            </div>
            <div class="creative-info-note">Playhead ${context.escHtml(context.formatCreativeTimelineTime(context.creativeTimelineMs))} of ${context.escHtml(context.formatCreativeTimelineTime(Math.max(1000, Number(context.creativeSceneDoc.durationMs) || 12000)))}</div>
          <input type="range" data-creative-timeline-range="true" min="0" max="${Math.max(1000, Number(context.creativeSceneDoc.durationMs) || 12000)}" step="50" value="${context.creativeTimelineMs}" oninput="canvasSetCreativeTimeline(this.value)" style="width:100%;margin-top:12px">
            <div class="creative-pill-row" style="margin-top:12px">
              <button onclick="toggleCreativePlayback()" class="creative-chip-btn creative-chip-btn--accent">${context.isCreativePlaybackActive() ? 'Pause' : 'Play'}</button>
              <button onclick="stopCreativePlayback({ reset: true, persist: true })" class="creative-chip-btn">Reset</button>
            </div>
          </section>
        ` : ''}
        ${audioCard}
        ${context.renderCreativeQuickExportCardStudioV3()}
        ${context.renderCreativeSavedAssetsCardStudioV3()}
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Studio note</div>
            <div class="creative-card-subtitle">Drag elements directly on the frame. In video mode, frame edits at the playhead become keyframes, and timeline diamonds can be retimed in place.</div>
          </div>
          <div class="creative-info-note">The outer app header stays untouched while this canvas shell carries the focused Image and Video studio styling.</div>
        </section>
      </div>
    `;
  }

  if (timeline && timelineTracks && timelineMeta) {
    const isVideo = mode === 'video';
    timeline.style.display = isVideo ? 'flex' : 'none';
    if (isVideo) {
      const durationMs = Math.max(1000, Number(context.creativeSceneDoc.durationMs) || 12000);
      const playheadLeft = Math.max(0, Math.min(100, (context.creativeTimelineMs / durationMs) * 100));
      const ticks = context.buildCreativeTimelineTicksStudioV3(durationMs, 7);
      const htmlMotionTracks = (context.creativeSceneDoc.elements.length === 0)
        ? context.getCreativeHtmlMotionTimelineTracks(durationMs)
        : [];
      const totalTrackCount = context.creativeSceneDoc.elements.length + htmlMotionTracks.length;
      const compositionSummary = context.creativeComposition ? context.summarizeComposition(context.creativeComposition) : null;
      const visibleTrackCount = totalTrackCount + (compositionSummary?.trackCount || 0);
      timelineMeta.textContent = `${visibleTrackCount} tracks | ${context.formatCreativeTimelineTime(durationMs)} | ${Number(context.creativeSceneDoc.frameRate) || 60} fps | playhead ${context.formatCreativeTimelineTime(context.creativeTimelineMs)}${hasAudioTrack ? ' | audio armed' : ''}`;
      const audioStartMs = Math.max(0, Number(audioTrack.startMs) || 0);
      const audioDurationMs = Math.max(0, Number(audioTrack.durationMs) || 0) || Math.max(0, durationMs - audioStartMs);
      const audioLeft = Math.max(0, Math.min(100, (audioStartMs / durationMs) * 100));
      const audioWidth = hasAudioTrack
        ? Math.max(8, Math.min(100 - audioLeft, (audioDurationMs / durationMs) * 100))
        : 0;
      timelineTracks.innerHTML = `
        <div class="creative-timeline-scroll-inner">
          <div class="creative-timeline-controls">
            <div class="creative-timeline-controls-left">
              <button onclick="toggleCreativePlayback()" class="creative-chip-btn creative-chip-btn--accent">${context.isCreativePlaybackActive() ? 'Pause' : 'Play'}</button>
              <button onclick="stopCreativePlayback({ reset: true, persist: true })" class="creative-chip-btn">Reset</button>
            </div>
            <div><input type="range" data-creative-timeline-range="true" min="0" max="${durationMs}" step="50" value="${context.creativeTimelineMs}" oninput="canvasSetCreativeTimeline(this.value)" style="width:100%"></div>
          </div>
          <div class="creative-timeline-ruler">
            ${ticks.map((tick) => `<div class="creative-timeline-ruler-tick" style="left:${tick.left}%">${context.escHtml(tick.label)}</div>`).join('')}
          </div>
          ${context.renderCompositionTimelineStrip()}
        ` + context.creativeSceneDoc.elements.map((element, idx) => {
          const label = context.getCreativeElementDisplayLabelStudioV3(element, idx);
          const keyframes = Array.isArray(element.meta?.keyframes) ? element.meta.keyframes.slice().sort((a, b) => (a.atMs || 0) - (b.atMs || 0)) : [];
          const hasMultiKeyframes = keyframes.length >= 2;
          const firstAt = keyframes.length ? Math.max(0, Number(keyframes[0].atMs) || 0) : 0;
          const lastAt = hasMultiKeyframes ? Math.max(firstAt, Number(keyframes[keyframes.length - 1].atMs) || 0) : durationMs;
          const left = keyframes.length ? Math.max(0, Math.min(100, (firstAt / durationMs) * 100)) : 0;
          const width = hasMultiKeyframes
            ? Math.max(0.5, Math.min(100 - left, ((lastAt - firstAt) / durationMs) * 100))
            : (keyframes.length === 1 ? Math.max(0.5, 100 - left) : 100);
          const firstKfId = keyframes.length ? keyframes[0].id : '';
          const lastKfId = keyframes.length ? keyframes[keyframes.length - 1].id : '';
          const hfTrackCount = element.type === 'hyperframes' && Array.isArray(element.meta?.tracks) ? element.meta.tracks.length : 0;
          const trackMetaLine = hfTrackCount
            ? `${hfTrackCount} HyperFrames tracks`
            : (keyframes.length ? `${keyframes.length} keyframes` : 'Static layer');
          return `
            <div class="creative-timeline-track">
              <button type="button" class="creative-timeline-track-label ${element.id === context.creativeSelectedId ? 'is-selected' : ''}" onclick="canvasSelectCreativeElement('${element.id}')">
                <span class="creative-timeline-track-icon"><iconify-icon icon="${context.escHtml(context.getCreativeTimelineElementIconStudioV3(element.type))}" width="16" height="16"></iconify-icon></span>
                <span class="creative-timeline-track-copy">
                  <span class="creative-timeline-track-title">${context.escHtml(String(label).slice(0, 42))}</span>
                  <span class="creative-timeline-track-meta-line">${context.escHtml(trackMetaLine)}</span>
                </span>
              </button>
              <div class="creative-timeline-track-lane" onmousedown="canvasHandleCreativeTimelineLanePointer(event, '${element.id}', this)">
                <div class="creative-timeline-track-fill ${element.id === context.creativeSelectedId ? 'is-selected' : ''}" style="left:${left}%;width:${width}%">
                  ${hasMultiKeyframes ? `
                    <div class="creative-timeline-track-edge creative-timeline-track-edge--start" title="Trim start" onmousedown="canvasBeginCreativeTrimGesture(event, '${element.id}', '${firstKfId}', 'start', this.closest('.creative-timeline-track-lane'))"></div>
                    <div class="creative-timeline-track-edge creative-timeline-track-edge--end" title="Trim end" onmousedown="canvasBeginCreativeTrimGesture(event, '${element.id}', '${lastKfId}', 'end', this.closest('.creative-timeline-track-lane'))"></div>
                  ` : ''}
                </div>
                ${keyframes.map((keyframe) => {
                  const dotLeft = Math.max(0, Math.min(100, ((Number(keyframe.atMs) || 0) / durationMs) * 100));
                  const isActive = Number(keyframe.atMs) === Number(context.creativeTimelineMs);
                  return `<div class="creative-timeline-keyframe ${isActive ? 'is-active' : ''}" title="${context.escHtml(`${context.formatCreativeTimelineTime(keyframe.atMs)} | drag to retime`)}" style="left:${dotLeft}%" onmousedown="canvasBeginCreativeKeyframeDrag(event, '${element.id}', '${keyframe.id}', this.parentElement)"></div>`;
                }).join('')}
                <div class="creative-timeline-playhead" style="left:calc(${playheadLeft}% - 0.5px)"></div>
              </div>
            </div>
          `;
        }).join('') + htmlMotionTracks.map((track) => {
          const left = Math.max(0, Math.min(100, (track.startMs / durationMs) * 100));
          const widthRaw = ((track.endMs - track.startMs) / durationMs) * 100;
          const width = Math.max(0.5, Math.min(100 - left, widthRaw));
          const isSelected = track.isSelected;
          const selectorAttr = encodeURIComponent(track.selector || '');
          return `
            <div class="creative-timeline-track" data-html-motion-track="true">
              <button type="button" class="creative-timeline-track-label ${isSelected ? 'is-selected' : ''}" onclick="canvasSelectCreativeHtmlMotionBySelector('${selectorAttr}')">
                <span class="creative-timeline-track-icon"><iconify-icon icon="${context.escHtml(track.icon)}" width="16" height="16"></iconify-icon></span>
                <span class="creative-timeline-track-copy">
                  <span class="creative-timeline-track-title">${context.escHtml(String(track.label).slice(0, 42))}</span>
                  <span class="creative-timeline-track-meta-line">${context.escHtml(track.metaLine)}</span>
                </span>
              </button>
              <div class="creative-timeline-track-lane" data-html-motion-selector="${context.escHtml(selectorAttr)}" onmousedown="canvasHandleCreativeHtmlMotionLanePointer(event, '${selectorAttr}', this)">
                <div class="creative-timeline-track-fill ${isSelected ? 'is-selected' : ''}" style="left:${left}%;width:${width}%"></div>
                <div class="creative-timeline-keyframe" title="${context.escHtml(`Start ${context.formatCreativeTimelineTime(track.startMs)}`)}" style="left:${left}%"></div>
                <div class="creative-timeline-keyframe" title="${context.escHtml(`End ${context.formatCreativeTimelineTime(track.endMs)}`)}" style="left:${Math.max(0, Math.min(100, (track.endMs / durationMs) * 100))}%"></div>
                <div class="creative-timeline-playhead" style="left:calc(${playheadLeft}% - 0.5px)"></div>
              </div>
            </div>
          `;
        }).join('') + `
          <div class="creative-timeline-track creative-timeline-track--audio">
            <button type="button" class="creative-timeline-track-label ${hasAudioTrack ? 'is-audio' : ''}" onclick="canvasSelectCreativeInspectorTab('properties')">
              <span class="creative-timeline-track-icon"><iconify-icon icon="solar:music-notes-bold-duotone" width="16" height="16"></iconify-icon></span>
              <span class="creative-timeline-track-copy">
                <span class="creative-timeline-track-title">${context.escHtml(audioLabel)}</span>
                <span class="creative-timeline-track-meta-line">${context.escHtml(hasAudioTrack ? `starts ${context.formatCreativeTimelineTime(audioStartMs)} | volume ${audioTrack.volume.toFixed(2)}` : 'Add an audio source in the inspector to arm the lane.')}</span>
              </span>
            </button>
            <div class="creative-timeline-track-lane creative-timeline-track-lane--audio" onmousedown="canvasHandleCreativeAudioLanePointer(event, this)">
              ${hasAudioTrack ? `
                <div class="creative-timeline-track-fill creative-timeline-track-fill--audio" style="left:${audioLeft}%;width:${audioWidth}%">
                  <div class="creative-timeline-track-edge creative-timeline-track-edge--start" title="Trim audio start" onmousedown="canvasBeginCreativeAudioTrimGesture(event, 'start', this.closest('.creative-timeline-track-lane'))"></div>
                  <div class="creative-timeline-track-edge creative-timeline-track-edge--end" title="Trim audio end" onmousedown="canvasBeginCreativeAudioTrimGesture(event, 'end', this.closest('.creative-timeline-track-lane'))"></div>
                </div>
                <canvas class="creative-timeline-audio-wave-canvas" data-audio-left="${audioLeft}" data-audio-width="${audioWidth}"></canvas>
              ` : `<div class="creative-timeline-audio-empty">No audio on the timeline yet — add a source in the inspector</div>`}
              <div class="creative-timeline-playhead" style="left:calc(${playheadLeft}% - 0.5px)"></div>
            </div>
          </div>
        </div>
      `;
    } else {
      timelineTracks.innerHTML = '';
      timelineMeta.textContent = '';
    }
  }
  context.ensureCreativeStageResizeObserver(stageScroll);
  context.canvasInstallCreativeStageWheelZoom();
  context.canvasInstallCreativeStageSelectionClear();
  context.scheduleCreativeStageViewportSync({ center: context.creativeStageZoomMode !== 'manual' });
  // Draw real waveform on the canvas element after innerHTML is committed
  if (timeline && timeline.style.display !== 'none') {
    requestAnimationFrame(() => context.drawCreativeWaveformCanvas(audioTrack));
  }
}

export async function handleCreativeCommandMessage(context, message) {
  await context.ensureCreativeFeatureRuntime();
  const previousActiveSessionId = String(context.window.activeChatSessionId || '').trim();
  const previousAgentSessionId = String(context.window.agentSessionId || '').trim();
  const previousCreativeMode = context.window.currentCreativeMode;
  const previousSuppress = context.window.__pmSuppressCreativeAutoOpen;
  if (!(await context.ensureCreativeCommandSessionActive(message, { previousActiveSessionId }))) {
    context.sendCreativeCommandResult(message, {
      success: false,
      error: 'Creative command target session is not available in this UI client.',
    });
    return;
  }
  const backgroundCommand = previousActiveSessionId && String(message?.sessionId || '').trim() !== previousActiveSessionId;
  try {
    const command = String(message?.command || '').trim();
    const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
    const mode = context.normalizeCreativeMode(context.window.currentCreativeMode);
    if (!context.isStructuredCreativeMode(mode)) {
      context.sendCreativeCommandResult(message, {
        success: false,
        error: 'No Image or Video creative workspace is active in this UI session.',
      });
      return;
    }
    context.ensureCreativeSceneForMode(mode);

    let data = null;
    if (command === 'get_state') {
    data = {
      scene: context.summarizeCreativeSceneForCommand(),
      selectedElement: context.getCreativeCommandSelectedElement(),
      selectionContext: context.creativeSelectedId ? context.buildSceneSelectionContext(context.creativeSceneDoc, context.creativeSelectedId) : null,
        htmlMotionClip: context.normalizeCreativeHtmlMotionClip(context.creativeHtmlMotionClip),
        audioTrack: context.getCreativeAudioTrackConfig(),
        creativeLibraries: context.normalizeCreativeMode(mode) === 'video'
          ? {
              videoSurface: 'Prometheus Video editor supports editable scene-graph media layers plus HTML Motion, HyperFrames, Remotion, and Pretext clips.',
              htmlMotionAccess: 'Create with creative_create_html_motion_clip or creative_apply_html_motion_template, edit existing clips with creative_read_html_motion_clip plus creative_patch_html_motion_clip, inspect with creative_render_html_motion_snapshot, then export with creative_export_html_motion_clip.',
              hyperframesAccess: 'Use hyperframes_browse_catalog, hyperframes_insert_clip, hyperframes_apply_patch, hyperframes_lint, hyperframes_qa, and hyperframes_export for component-driven video systems. Use creative_* HyperFrames tools only for legacy compatibility.',
              remotionAccess: 'Use creative_list_motion_templates, creative_preview_motion_template, creative_apply_motion_template, and creative_generate_motion_variants for Remotion-backed video systems.',
              elementTypes: ['text', 'shape', 'icon', 'image', 'video', 'audio', 'group', 'hyperframes'],
              assetAccess: 'Generated and imported Creative assets hydrate into the Prometheus Video editor asset panel. Use creative_add_asset/add_element or generation tools to place durable workspace-backed media layers.',
            }
          : {
              iconSystem: 'Iconify',
              iconAccess: 'Any valid Iconify icon name is accepted in meta.iconName, such as solar:..., lucide:..., mdi:..., simple-icons:..., tabler:..., ph:..., heroicons:..., logos:..., etc.',
              elementTypes: ['text', 'shape', 'icon', 'image', 'video', 'group'],
              assetAccess: 'Uploaded image/video workspace paths can be placed as editable layers with creative_add_asset. Image layers use meta.source/fit/radius. Video layers use meta.source/fit/radius/timelineStartMs/timelineDurationMs/trimStartMs/volume/muted and can still be moved, resized, rotated, faded, layered, and animated.',
              shapeKinds: ['rect', 'circle', 'triangle', 'polygon', 'line', 'arrow'],
              fontAccess: 'Use any installed/web-safe font family by setting text meta.fontFamily. Manrope is the default.',
              commonFonts: ['Manrope', 'Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Montserrat', 'Poppins', 'Bebas Neue'],
              animationPresetIds: context.getActiveCreativeAnimationPresetCatalog()
                .map((preset) => preset.id)
                .slice(0, 80),
              animationAccess: 'Use any available built-in or enabled custom animation preset id with creative_apply_animation or add-animation-preset.',
              stylePresets: context.CREATIVE_STYLE_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
                fonts: preset.fonts,
                colors: preset.colors,
                recommendedMotion: preset.motion,
              })),
              componentPresets: ['cta-card', 'caption-block', 'feature-card', 'logo-lockup', 'lower-third', 'product-callout'],
            },
        assets: {
          storageRoot: context.creativeAssetsState?.storageRoot || '',
          exports: Array.isArray(context.creativeAssetsState?.exports) ? context.creativeAssetsState.exports.length : 0,
          scenes: Array.isArray(context.creativeAssetsState?.scenes) ? context.creativeAssetsState.scenes.length : 0,
          indexedAssets: Array.isArray(context.creativeAssetsState?.indexedAssets) ? context.creativeAssetsState.indexedAssets.length : 0,
      },
    };
  } else if (command === 'reset_scene') {
    const previousHash = context.hashCreativeObject(context.creativeSceneDoc);
    const hasSceneWork = !!context.creativeHtmlMotionClip
      || (Array.isArray(context.creativeSceneDoc?.elements) && context.creativeSceneDoc.elements.length > 0)
      || (Array.isArray(context.creativeSceneDoc?.motionTemplates) && context.creativeSceneDoc.motionTemplates.length > 0)
      || (Array.isArray(context.creativeSceneDoc?.captions) && context.creativeSceneDoc.captions.length > 0);
    if (hasSceneWork && payload.force !== true) {
      throw new Error('reset_scene refused because the current scene has work in it. Save a creative_checkpoint first, or call reset_scene with force=true only for an explicit fresh start.');
    }
    context.commitCreativeHistorySnapshot(context.captureCreativeSnapshot());
    context.creativeHistoryFuture = [];
    context.creativeSceneDoc = context.createBlankCreativeScene(mode);
    context.creativeSelectedId = null;
    context.creativeTimelineMs = 0;
    context.creativeHtmlMotionClip = null;
    context.stopCreativeAudioPreview({ reset: true, dispose: true });
    context.setCreativeSceneDoc(context.creativeSceneDoc, { render: false, persist: false, allowBlankOverwrite: true });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = {
      reset: true,
      mode,
      previousHash,
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
    };
  } else if (command === 'purge_scene') {
    const targets = Array.isArray(payload.targets) && payload.targets.length
      ? payload.targets.map((target) => String(target || '').trim().toLowerCase())
      : ['hidden', 'offscreen', 'empty_text', 'duplicate_ids'];
    const doc = context.creativeSceneDoc || context.createSceneDocument();
    const width = Math.max(1, Number(doc.width) || 1080);
    const height = Math.max(1, Number(doc.height) || 1080);
    const seenIds = new Set();
    const removed = [];
    const keep = [];
    (Array.isArray(doc.elements) ? doc.elements : []).forEach((element) => {
      const id = String(element?.id || '').trim();
      const bounds = {
        right: (Number(element?.x) || 0) + (Number(element?.width) || 0),
        bottom: (Number(element?.y) || 0) + (Number(element?.height) || 0),
        left: Number(element?.x) || 0,
        top: Number(element?.y) || 0,
      };
      const reasons = [];
      if (targets.includes('duplicate_ids') && id && seenIds.has(id)) reasons.push('duplicate_id');
      if (targets.includes('hidden') && (element.visible === false || Number(element.opacity) === 0)) reasons.push('hidden');
      if (targets.includes('offscreen') && (bounds.right < 0 || bounds.bottom < 0 || bounds.left > width || bounds.top > height)) reasons.push('offscreen');
      if (targets.includes('empty_text') && element.type === 'text' && !String(element.meta?.content || '').trim()) reasons.push('empty_text');
      if (reasons.length) removed.push({ id, type: element.type, label: element.meta?.content || element.meta?.iconName || element.type, reasons });
      else keep.push(element);
      if (id) seenIds.add(id);
    });
    const nextDoc = context.createSceneDocument({ ...doc, elements: keep });
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    if (context.creativeSelectedId && !keep.some((element) => element.id === context.creativeSelectedId)) context.creativeSelectedId = keep[keep.length - 1]?.id || null;
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = {
      targets,
      removedCount: removed.length,
      removed,
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
    };
  } else if (command === 'element_inventory') {
    data = {
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      inventory: context.getCreativeElementInventory({ includeHidden: payload.includeHidden !== false }),
      motionTemplates: Array.isArray(context.creativeSceneDoc?.motionTemplates) ? context.creativeSceneDoc.motionTemplates : [],
      captions: Array.isArray(context.creativeSceneDoc?.captions) ? context.creativeSceneDoc.captions : [],
      validation: context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode }),
    };
  } else if (command === 'frame_trace') {
    const durationMs = Math.max(1000, Number(context.creativeSceneDoc?.durationMs) || 12000);
    const times = Array.isArray(payload.timesMs) && payload.timesMs.length
      ? payload.timesMs
      : [Number.isFinite(Number(payload.atMs)) ? Number(payload.atMs) : context.creativeTimelineMs];
    data = {
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      traces: times
        .map((value) => Math.max(0, Math.min(durationMs, Number(value) || 0)))
        .slice(0, 12)
        .map((atMs) => context.getCreativeFrameTraceAt(atMs)),
    };
  } else if (command === 'frame_diff') {
    const leftAtMs = Math.max(0, Number(payload.leftAtMs ?? payload.fromMs) || 0);
    const rightAtMs = Math.max(0, Number(payload.rightAtMs ?? payload.toMs) || Math.max(0, leftAtMs + 1000));
    const left = context.getCreativeFrameTraceAt(leftAtMs);
    const right = context.getCreativeFrameTraceAt(rightAtMs);
    data = {
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      leftAtMs,
      rightAtMs,
      changed: context.diffCreativeFrameTraces(left, right),
      leftActiveIds: left.elements.filter((element) => element.active).map((element) => element.id),
      rightActiveIds: right.elements.filter((element) => element.active).map((element) => element.id),
    };
  } else if (command === 'history_status') {
    data = {
      canUndo: context.creativeHistoryPast.length > 0,
      canRedo: context.creativeHistoryFuture.length > 0,
      undoCount: context.creativeHistoryPast.length,
      redoCount: context.creativeHistoryFuture.length,
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
      htmlMotionClip: context.normalizeCreativeHtmlMotionClip(context.creativeHtmlMotionClip),
    };
  } else if (command === 'undo') {
    if (!context.creativeHistoryPast.length) throw new Error('No creative history entry is available to undo.');
    context.canvasUndoCreativeChange();
    data = {
      undone: true,
      canUndo: context.creativeHistoryPast.length > 0,
      canRedo: context.creativeHistoryFuture.length > 0,
      undoCount: context.creativeHistoryPast.length,
      redoCount: context.creativeHistoryFuture.length,
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
      htmlMotionClip: context.normalizeCreativeHtmlMotionClip(context.creativeHtmlMotionClip),
    };
  } else if (command === 'redo') {
    if (!context.creativeHistoryFuture.length) throw new Error('No creative history entry is available to redo.');
    context.canvasRedoCreativeChange();
    data = {
      redone: true,
      canUndo: context.creativeHistoryPast.length > 0,
      canRedo: context.creativeHistoryFuture.length > 0,
      undoCount: context.creativeHistoryPast.length,
      redoCount: context.creativeHistoryFuture.length,
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
      htmlMotionClip: context.normalizeCreativeHtmlMotionClip(context.creativeHtmlMotionClip),
    };
  } else if (command === 'checkpoint') {
    const action = String(payload.action || 'save').trim().toLowerCase();
    const session = context.getActiveChatSessionRecord();
    const checkpoints = Array.isArray(session?.creativeCheckpoints) ? session.creativeCheckpoints : [];
    if (action === 'restore') {
      const id = String(payload.id || '').trim();
      const checkpoint = checkpoints.find((entry) => String(entry?.id || '') === id) || checkpoints[checkpoints.length - 1];
      if (!checkpoint) throw new Error('No creative checkpoint found to restore.');
      context.commitCreativeHistorySnapshot(context.captureCreativeSnapshot());
      context.restoreCreativeSnapshot(checkpoint.snapshot, { render: true, persist: true });
      data = { restored: true, id: checkpoint.id, label: checkpoint.label || '', sceneHash: context.hashCreativeObject(context.creativeSceneDoc) };
    } else {
      const checkpoint = {
        id: `creative_checkpoint_${Date.now().toString(36)}`,
        label: String(payload.label || '').trim() || `Checkpoint ${checkpoints.length + 1}`,
        createdAt: new Date().toISOString(),
        sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
        snapshot: context.captureCreativeSnapshot(),
      };
      if (session) {
        session.creativeCheckpoints = [...checkpoints, checkpoint].slice(-20);
        context.saveChatSessions();
      }
      data = {
        saved: true,
        id: checkpoint.id,
        label: checkpoint.label,
        sceneHash: checkpoint.sceneHash,
        checkpointCount: session?.creativeCheckpoints?.length || 1,
      };
    }
  } else if (command === 'export_trace') {
    const exports = Array.isArray(context.creativeAssetsState?.exports) ? context.creativeAssetsState.exports.slice(0, 10) : [];
    data = {
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      currentScene: context.summarizeCreativeSceneForCommand(),
      activeExport: context.creativeActiveExport || null,
      recentExports: exports,
      renderJobs: Array.isArray(context.creativeAssetsState?.renderJobs) ? context.creativeAssetsState.renderJobs.slice(0, 10) : [],
      validation: context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode }),
    };
  } else if (command === 'quality_report') {
    data = context.buildCreativeQualityReport({
      sampleTimesMs: payload.sampleTimesMs,
      includeHidden: payload.includeHidden !== false,
    });
  } else if (command === 'video_analyze_timeline') {
    const durationMs = Math.max(1000, Number(context.creativeSceneDoc?.durationMs) || 12000);
    const sampleTimes = Array.isArray(payload.sampleTimesMs) && payload.sampleTimesMs.length
      ? payload.sampleTimesMs.map((value) => Math.max(0, Math.min(durationMs, Number(value) || 0))).slice(0, 12)
      : [0, Math.round(durationMs / 2), Math.max(0, durationMs - 250)];
    const traces = sampleTimes.map((atMs) => context.getCreativeFrameTraceAt(atMs));
    data = {
      sceneHash: context.hashCreativeObject(context.creativeSceneDoc),
      scene: context.summarizeCreativeSceneForCommand(),
      inventory: context.getCreativeElementInventory({ includeHidden: payload.includeHidden !== false }),
      validation: context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode }),
      keyframes: context.checkCreativeKeyframes(),
      captions: context.checkCreativeCaptionTiming(),
      audioSync: context.checkCreativeAudioSync(),
      traces,
      diffs: traces.slice(1).map((trace, index) => ({
        leftAtMs: traces[index].atMs,
        rightAtMs: trace.atMs,
        changed: context.diffCreativeFrameTraces(traces[index], trace),
      })),
    };
  } else if (command === 'video_check_keyframes') {
    data = context.checkCreativeKeyframes();
  } else if (command === 'video_check_caption_timing') {
    data = context.checkCreativeCaptionTiming();
  } else if (command === 'video_check_audio_sync') {
    data = context.checkCreativeAudioSync();
  } else if (command === 'image_get_element_at_point') {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('image_get_element_at_point requires numeric x and y.');
    const atMs = Number.isFinite(Number(payload.atMs)) ? Number(payload.atMs) : context.creativeTimelineMs;
    const matches = (Array.isArray(context.creativeSceneDoc?.elements) ? context.creativeSceneDoc.elements : [])
      .map((element, index) => {
        const rendered = mode === 'video' ? (context.resolveElementAtTime(element, atMs) || element) : element;
        return { element: rendered, index, bounds: context.getCreativeElementBounds(rendered) };
      })
      .filter(({ element, bounds }) => element.visible !== false && Number(element.opacity ?? 1) > 0.001 && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom)
      .sort((a, b) => (Number(b.element.zIndex || 0) - Number(a.element.zIndex || 0)) || (b.index - a.index))
      .map(({ element, bounds }) => ({
        id: element.id,
        type: element.type,
        label: element.meta?.content || element.meta?.iconName || element.meta?.source || element.type,
        zIndex: element.zIndex,
        bounds,
      }));
    data = { x, y, atMs, topElement: matches[0] || null, matches };
  } else if (command === 'image_get_overlaps') {
    data = {
      threshold: Math.max(0, Number(payload.threshold ?? 0.02) || 0.02),
      atMs: Number.isFinite(Number(payload.atMs)) ? Number(payload.atMs) : context.creativeTimelineMs,
      overlaps: context.getCreativeOverlapDetails(payload),
      validation: context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode }),
    };
  } else if (command === 'image_get_bounds_summary') {
    const doc = context.creativeSceneDoc || context.createSceneDocument();
    const elements = context.getCreativeElementInventory({ includeHidden: payload.includeHidden !== false }).map((entry) => ({
      ...entry,
      bounds: context.getCreativeElementBounds(entry),
      offCanvas: entry.x + entry.width < 0 || entry.y + entry.height < 0 || entry.x > doc.width || entry.y > doc.height,
    }));
    const union = context.getCreativeElementsBounds(elements);
    data = {
      canvas: { width: doc.width, height: doc.height },
      elementCount: elements.length,
      unionBounds: union,
      offCanvas: elements.filter((entry) => entry.offCanvas),
      elements,
    };
  } else if (command === 'image_check_text_overflow') {
    const details = context.getCreativeTextOverflowDetails();
    data = {
      ok: !details.some((entry) => entry.overflow),
      issueCount: details.filter((entry) => entry.overflow).length,
      textCount: details.length,
      details,
    };
  } else if (command === 'image_check_contrast') {
    const details = context.getCreativeContrastDetails();
    data = {
      ok: !details.some((entry) => entry.passesAA === false),
      issueCount: details.filter((entry) => entry.passesAA === false).length,
      textCount: details.length,
      details,
    };
  } else if (command === 'image_detect_empty_regions') {
    data = context.detectCreativeEmptyRegions(payload);
  } else if (command === 'attach_audio') {
    if (mode !== 'video') throw new Error('attach_audio is only available in Video mode.');
    const incomingTrack = payload?.audioTrack && typeof payload.audioTrack === 'object' && !Array.isArray(payload.audioTrack)
      ? payload.audioTrack
      : payload;
    const normalizedTrack = context.getCreativeAudioTrackConfig(incomingTrack || {});
    if (!normalizedTrack.source) throw new Error('attach_audio requires audioTrack.source.');
    context.creativeAudioAnalysisRequestToken += 1;
    const nextDoc = context.createSceneDocument({
      ...context.creativeSceneDoc,
      audioTrack: normalizedTrack,
    });
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    context.addProcessEntry('info', `${context.getStructuredCreativeModeLabel('video')}: attached audio lane ${normalizedTrack.label || normalizedTrack.source}.`);
    void context.syncCreativeAudioTrackAnalysis(nextDoc, { force: true, silent: true });
    data = {
      audioTrack: normalizedTrack,
      sourceUrl: payload?.sourceUrl || null,
      asset: payload?.asset || null,
    };
  } else if (command === 'apply_ops') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    const { ops, canvasPatch } = context.normalizeCreativeCommandOps(payload);
    if (!ops.length && !Object.keys(canvasPatch).length) throw new Error('apply_ops requires a non-empty ops or operations array.');
    const beforeIds = new Set((context.creativeSceneDoc.elements || []).map((element) => element.id));
    const sourceDoc = Object.keys(canvasPatch).length ? context.createSceneDocument({ ...context.creativeSceneDoc, ...canvasPatch }) : context.creativeSceneDoc;
    const nextDoc = ops.length ? context.executeSceneGraphOps(sourceDoc, ops) : sourceDoc;
    const added = nextDoc.elements.find((element) => !beforeIds.has(element.id));
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    if (added?.id) context.setCreativeSelection(added.id, { render: false });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = { appliedOps: ops.length, canvasPatch };
  } else if (command === 'select_element') {
    const id = String(payload.id || '').trim();
    if (!id) throw new Error('select_element requires id.');
    context.setCreativeSelection(id);
    context.persistActiveChat();
    data = { selectedId: id };
    } else if (command === 'set_canvas') {
      const patch = {};
      ['width', 'height', 'durationMs', 'frameRate'].forEach((key) => {
        if (Number.isFinite(Number(payload[key]))) patch[key] = Number(payload[key]);
      });
      if (mode === 'video') patch.frameRate = Math.max(60, Number(patch.frameRate) || Number(context.creativeSceneDoc?.frameRate) || 60);
      if (typeof payload.background === 'string' && payload.background.trim()) patch.background = payload.background.trim();
    if (!Object.keys(patch).length) throw new Error('set_canvas requires at least one canvas property.');
    context.setCreativeSceneDoc(context.createSceneDocument({ ...context.creativeSceneDoc, ...patch }), { recordHistory: true });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = { patch };
    } else if (command === 'add_element') {
      context.clearCreativeHtmlMotionClip({ render: false, persist: false });
      const type = String(payload.type || '').trim().toLowerCase();
      if (!['text', 'shape', 'icon', 'image', 'video', 'audio', 'group'].includes(type)) throw new Error('add_element requires type text, shape, icon, image, video, audio, or group.');
      const nextDoc = context.executeSceneGraphOps(context.creativeSceneDoc, [{
        op: 'add',
      type,
      x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : 120,
      y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : 120,
      width: Number.isFinite(Number(payload.width)) ? Number(payload.width) : 320,
      height: Number.isFinite(Number(payload.height)) ? Number(payload.height) : 160,
      rotation: Number.isFinite(Number(payload.rotation)) ? Number(payload.rotation) : 0,
      opacity: Number.isFinite(Number(payload.opacity)) ? Number(payload.opacity) : 1,
      zIndex: Number.isFinite(Number(payload.zIndex)) ? Number(payload.zIndex) : (context.creativeSceneDoc.elements || []).length,
      meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    }]);
    const added = nextDoc.elements[nextDoc.elements.length - 1] || null;
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    if (added?.id) context.setCreativeSelection(added.id, { render: false });
      context.renderCreativeWorkspace();
      context.persistActiveChat();
      data = { addedId: added?.id || null };
    } else if (command === 'add_asset') {
      data = context.applyCreativeAddAssetCommand(payload);
    } else if (command === 'search_icons') {
      const query = String(payload.query || '').trim();
      if (!query) throw new Error('search_icons requires query.');
      const limit = Math.max(1, Math.min(64, Number(payload.limit) || 24));
      const fallbackIcons = [
        'lucide:flame', 'solar:fire-bold-duotone', 'mdi:fire', 'ph:flame-bold',
        'lucide:bot', 'lucide:sparkles', 'solar:stars-bold-duotone', 'tabler:sparkles',
        'lucide:zap', 'solar:bolt-bold-duotone', 'mdi:lightning-bolt', 'ph:lightning-bold',
        'lucide:cpu', 'lucide:terminal-square', 'tabler:automation', 'mdi:robot',
        'simple-icons:openai', 'logos:openai-icon',
      ];
      let iconData = {};
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6500);
        const response = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${limit}`, { signal: controller.signal });
        clearTimeout(timer);
        iconData = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(iconData?.error || `Iconify search failed with HTTP ${response.status}`);
      } catch (err) {
        iconData = {
          icons: fallbackIcons.filter((icon) => {
            const haystack = icon.toLowerCase().replace(/[:-]/g, ' ');
            const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
            return terms.some((term) => haystack.includes(term)) || terms.some((term) => ['ai', 'operator', 'automation', 'tech', 'logo', 'prometheus', 'brand'].includes(term));
          }).slice(0, limit),
          total: fallbackIcons.length,
          fallback: true,
          error: String(err?.message || err || 'Iconify search timed out'),
        };
      }
      if (!Array.isArray(iconData.icons) || iconData.icons.length === 0) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const relevantFallbacks = fallbackIcons.filter((icon) => {
          const haystack = icon.toLowerCase().replace(/[:-]/g, ' ');
          return terms.some((term) => haystack.includes(term))
            || terms.some((term) => ['spark', 'motion', 'template', 'caption', 'video', 'creative', 'ai', 'automation', 'tech', 'bold', 'cta'].includes(term));
        });
        iconData = {
          ...iconData,
          icons: (relevantFallbacks.length ? relevantFallbacks : fallbackIcons).slice(0, limit),
          total: relevantFallbacks.length || fallbackIcons.length,
          fallback: true,
        };
      }
      data = {
        query,
        limit,
        icons: Array.isArray(iconData.icons) ? iconData.icons.slice(0, limit) : [],
        total: Number(iconData.total) || 0,
        fallback: iconData.fallback === true,
        error: iconData.error || null,
        usage: 'Use one returned value as meta.iconName on an icon element.',
      };
    } else if (command === 'search_animations') {
      const query = String(payload.query || '').trim().toLowerCase();
      const target = String(payload.target || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(64, Number(payload.limit) || 24));
      const presets = context.getActiveCreativeAnimationPresetCatalog(target)
        .filter((preset) => {
          if (!query) return true;
          const terms = query.split(/\s+/).filter(Boolean);
          const haystack = [
            preset.id,
            preset.label,
            preset.libraryId,
            ...(Array.isArray(preset.targets) ? preset.targets : []),
          ].join(' ').toLowerCase();
          return terms.some((term) => haystack.includes(term));
        })
        .slice(0, limit);
      data = {
        query,
        target: target || null,
        limit,
        presets,
        usage: 'Use one returned preset id with creative_apply_animation or add-animation-preset.',
      };
  } else if (command === 'update_element') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    const id = String(payload.id || '').trim();
    if (!id) throw new Error('update_element requires id.');
    const patch = context.normalizeCreativeCommandPatch(payload);
    if (!Object.keys(patch).length) throw new Error('update_element requires patch.');
    const nextDoc = context.executeSceneGraphOps(context.creativeSceneDoc, [{ op: 'set', id, patch }]);
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    context.setCreativeSelection(id, { render: false });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = { updatedId: id, patch };
  } else if (command === 'delete_element') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    const id = String(payload.id || '').trim();
    if (!id) throw new Error('delete_element requires id.');
    const nextDoc = context.executeSceneGraphOps(context.creativeSceneDoc, [{ op: 'delete', id }]);
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    context.setCreativeSelection(nextDoc.elements[nextDoc.elements.length - 1]?.id || null, { render: false });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = { deletedId: id };
  } else if (command === 'apply_animation') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    const id = String(payload.id || '').trim();
    const preset = String(payload.preset || '').trim();
    if (!id || !preset) throw new Error('apply_animation requires id and preset.');
    const nextDoc = context.executeSceneGraphOps(context.creativeSceneDoc, [{
      op: 'add-animation-preset',
      id,
      preset,
      startMs: Number.isFinite(Number(payload.startMs)) ? Number(payload.startMs) : context.creativeTimelineMs,
      durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : 500,
    }]);
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    context.setCreativeSelection(id, { render: false });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    data = { animatedId: id, preset };
  } else if (command === 'arrange') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    data = context.applyCreativeArrangeCommand(payload);
  } else if (command === 'apply_style') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    data = context.applyCreativeStyleCommand(payload);
  } else if (command === 'fit_asset') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    data = context.applyCreativeFitAssetCommand(payload);
  } else if (command === 'apply_template') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    data = context.applyCreativeTemplateCommand(payload);
  } else if (command === 'validate_layout') {
    const validation = context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode });
    data = {
      validation,
      ok: validation.ok,
      issueCount: validation.issueCount,
      errorCount: validation.errorCount,
      warnCount: validation.warnCount,
      usage: validation.ok
        ? 'Layout validation passed. Continue with visual frame QA before export.'
        : 'Fix error-level layout issues before export, then run creative_render_snapshot for visual QA.',
    };
  } else if (command === 'create_html_motion_clip') {
    if (mode !== 'video') throw new Error('create_html_motion_clip requires the video workspace.');
    data = await context.createCreativeHtmlMotionClip(payload);
  } else if (command === 'list_html_motion_templates') {
    if (mode !== 'video') throw new Error('list_html_motion_templates requires the video workspace.');
    data = await context.listCreativeHtmlMotionTemplates();
  } else if (command === 'apply_html_motion_template') {
    if (mode !== 'video') throw new Error('apply_html_motion_template requires the video workspace.');
    data = await context.applyCreativeHtmlMotionTemplate(payload);
  } else if (command === 'read_html_motion_clip') {
    if (mode !== 'video') throw new Error('read_html_motion_clip requires the video workspace.');
    data = await context.readCreativeHtmlMotionClip(payload);
  } else if (command === 'patch_html_motion_clip') {
    if (mode !== 'video') throw new Error('patch_html_motion_clip requires the video workspace.');
    data = await context.patchCreativeHtmlMotionClip(payload);
  } else if (command === 'restore_html_motion_revision') {
    if (mode !== 'video') throw new Error('restore_html_motion_revision requires the video workspace.');
    data = await context.restoreCreativeHtmlMotionClipRevision(payload);
  } else if (command === 'render_html_motion_snapshot') {
    if (mode !== 'video') throw new Error('render_html_motion_snapshot requires the video workspace.');
    const snapshotData = await context.renderCreativeHtmlMotionSnapshot({ ...payload, includeDataUrl: true });
    const snapshots = (Array.isArray(snapshotData.frames) ? snapshotData.frames : []).map((frame) => ({
      width: frame.width,
      height: frame.height,
      atMs: frame.atMs,
      mimeType: frame.mimeType || 'image/png',
      dataUrl: frame.dataUrl || '',
    }));
    data = {
      ...snapshotData,
      frames: snapshots.map(({ width, height, atMs, mimeType }) => ({ width, height, atMs, mimeType })),
    };
    context.sendCreativeCommandResult(message, {
      success: true,
      data,
      snapshot: snapshots.length === 1 ? snapshots[0] : null,
      snapshots,
    });
    return;
  } else if (command === 'export_html_motion_clip') {
    if (mode !== 'video') throw new Error('export_html_motion_clip requires the video workspace.');
    data = await context.exportCreativeHtmlMotionClip(payload);
  } else if (command === 'apply_motion_template') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    const prepared = await context.creativeMotionTemplateClient.prepareCreativeMotionTemplate(payload);
    const validation = prepared?.validation || {};
    if (Array.isArray(validation.blockers) && validation.blockers.length) {
      throw new Error(validation.blockers.join('; '));
    }
    const instance = prepared?.instance;
    if (!instance || typeof instance !== 'object') throw new Error('Motion template preparation did not return an instance.');
    const materialized = context.buildCreativeMotionTemplateSceneElements(instance);
    const sourceDoc = context.createSceneDocument({
      ...context.creativeSceneDoc,
      durationMs: Math.max(Number(context.creativeSceneDoc?.durationMs) || 0, Number(materialized.durationMs) || 0, Number(instance.durationMs) || 0, 12000),
      frameRate: Math.max(Number(context.creativeSceneDoc?.frameRate) || 0, Number(instance.input?.fps) || 0, 60),
      width: Number(materialized.width) || Number(instance.input?.width) || context.creativeSceneDoc?.width,
      height: Number(materialized.height) || Number(instance.input?.height) || context.creativeSceneDoc?.height,
      background: materialized.background || context.creativeSceneDoc?.background,
      captions: instance.input?.captions ? [instance.input.captions] : context.creativeSceneDoc?.captions,
      brandKit: instance.input?.brand || context.creativeSceneDoc?.brandKit || null,
    });
    const shouldReplace = payload.replace !== false;
    const baseDoc = shouldReplace
      ? context.createSceneDocument({
          ...sourceDoc,
          elements: [],
          motionTemplates: [],
        })
      : sourceDoc;
    const nextDoc = context.executeSceneGraphOps(baseDoc, [
      { op: 'add-motion-template', instance },
      ...(Array.isArray(materialized.elements) ? materialized.elements : []),
    ]);
    context.setCreativeSceneDoc(nextDoc, { render: false, recordHistory: true });
    context.setCreativeTimelinePosition(0, { render: false, persist: false });
    context.renderCreativeWorkspace();
    context.persistActiveChat();
    context.addProcessEntry('info', `${context.getStructuredCreativeModeLabel(mode)}: applied motion template ${prepared?.template?.name || instance.templateId}${materialized.elements?.length ? ` with ${materialized.elements.length} rendered layers` : ''}.`);
    context.showToast('Motion template applied', prepared?.template?.name || instance.templateId, 'success');
    data = {
      template: prepared?.template || null,
      instance,
      validation,
      renderedLayerCount: Array.isArray(materialized.elements) ? materialized.elements.length : 0,
      motionTemplateCount: Array.isArray(nextDoc.motionTemplates) ? nextDoc.motionTemplates.length : 0,
      elementCount: Array.isArray(nextDoc.elements) ? nextDoc.elements.length : 0,
    };
  } else if (command === 'timeline') {
    context.clearCreativeHtmlMotionClip({ render: false, persist: false });
    data = context.applyCreativeTimelineCommand(payload);
  } else if (command === 'render_snapshot') {
    if (mode === 'video' && context.creativeHtmlMotionClip) {
      const snapshotData = await context.renderCreativeHtmlMotionSnapshot({ ...payload, includeDataUrl: true });
      const snapshots = (Array.isArray(snapshotData.frames) ? snapshotData.frames : []).map((frame) => ({
        width: frame.width,
        height: frame.height,
        atMs: frame.atMs,
        mimeType: frame.mimeType || 'image/png',
        dataUrl: frame.dataUrl || '',
      }));
      data = {
        ...snapshotData,
        frames: snapshots.map(({ width, height, atMs, mimeType }) => ({ width, height, atMs, mimeType })),
      };
      context.sendCreativeCommandResult(message, {
        success: true,
        data,
        snapshot: snapshots.length === 1 ? snapshots[0] : null,
        snapshots,
      });
      return;
    }
    if (mode === 'video') {
      const requestedClipId = String(payload.clipId || payload.clip_id || payload.elementId || payload.element_id || '').trim();
      const hyperframesClip = requestedClipId
        ? context.getHyperframesElementById(requestedClipId)
        : (context.getSelectedCreativeElement()?.type === 'hyperframes'
            ? context.getSelectedCreativeElement()
            : (context.creativeSceneDoc.elements || []).find((element) => element?.type === 'hyperframes' && element.visible !== false));
      if (hyperframesClip && (hyperframesClip?.meta?.html || hyperframesClip?.meta?.projectPath)) {
        const html = await context.ensureHyperframesElementSourceHtml(hyperframesClip);
        if (!html.trim()) throw new Error('HyperFrames source HTML is missing.');
        const durationMs = Math.max(1000, Number(payload.durationMs || payload.duration_ms) || Number(hyperframesClip.meta.durationMs) || Number(context.creativeSceneDoc.durationMs) || 6000);
        let sampleTimes = Array.isArray(payload.sampleTimesMs)
          ? payload.sampleTimesMs.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        if (payload.contactSheet === true && sampleTimes.length === 0) {
          sampleTimes = [0, Math.round(durationMs / 2), Math.max(0, durationMs - 50)];
        }
        if (!sampleTimes.length && Number.isFinite(Number(payload.atMs))) sampleTimes = [Number(payload.atMs)];
        const qa = await context.api('/api/canvas/hyperframes/qa', {
          method: 'POST',
          body: {
            html,
            width: Number(payload.width) || Number(hyperframesClip.width) || Number(context.creativeSceneDoc.width) || 1080,
            height: Number(payload.height) || Number(hyperframesClip.height) || Number(context.creativeSceneDoc.height) || 1920,
            durationMs,
            samplePoints: sampleTimes,
            timeoutMs: Number(payload.timeoutMs || payload.timeout_ms) || undefined,
          },
        });
        if (!qa?.success) throw new Error(qa?.error || 'HyperFrames snapshot QA failed.');
        const report = qa.report || {};
        const snapshots = (Array.isArray(report.samples) ? report.samples : []).map((frame) => ({
          width: Number(payload.width) || Number(hyperframesClip.width) || Number(context.creativeSceneDoc.width) || 1080,
          height: Number(payload.height) || Number(hyperframesClip.height) || Number(context.creativeSceneDoc.height) || 1920,
          atMs: Number(frame.timeMs) || 0,
          mimeType: 'image/png',
          screenshotPath: frame.screenshotPath || '',
          dataUrl: '',
        }));
        data = {
          success: true,
          hyperframes: true,
          clipId: hyperframesClip.id,
          ok: report.ok !== false,
          sampleCount: snapshots.length,
          frames: snapshots.map(({ width, height, atMs, mimeType, screenshotPath }) => ({ width, height, atMs, mimeType, screenshotPath })),
          qa: report,
        };
        context.sendCreativeCommandResult(message, {
          success: true,
          data,
          snapshot: snapshots.length === 1 ? snapshots[0] : null,
          snapshots,
        });
        return;
      }
    }
    const previousTimeline = context.creativeTimelineMs;
    const includeDataUrl = true;
    const durationMs = Math.max(0, Number(context.creativeSceneDoc?.durationMs) || 0);
    const frameRate = Math.max(1, Number(context.creativeSceneDoc?.frameRate) || 60);
    const maxFrameSamples = Math.max(1, Math.min(600, Math.floor(Number(payload.maxFrames) || 600)));
    let sampleTimes = mode === 'video' && Array.isArray(payload.sampleTimesMs)
      ? payload.sampleTimesMs
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
    if (mode === 'video' && payload.contactSheet === true && sampleTimes.length === 0) {
      sampleTimes = [0, Math.round(Math.max(1000, durationMs || 8000) / 2), Math.max(0, Math.round((durationMs || 8000) - 250))];
    }
    if (mode === 'video' && payload.sampleEveryFrame === true) {
      const frameStepMs = Math.max(1, Math.round(1000 / frameRate));
      const startMs = Math.max(0, Number(payload.startMs) || 0);
      const endMs = Math.max(startMs, Math.min(durationMs || startMs, Number.isFinite(Number(payload.endMs)) ? Number(payload.endMs) : durationMs));
      sampleTimes = [];
      for (let atMs = startMs; atMs <= endMs && sampleTimes.length < maxFrameSamples; atMs += frameStepMs) {
        sampleTimes.push(Math.min(endMs, Math.round(atMs)));
      }
      if (durationMs > 0 && sampleTimes.length < maxFrameSamples && sampleTimes[sampleTimes.length - 1] !== endMs) {
        sampleTimes.push(endMs);
      }
    } else if (mode === 'video' && sampleTimes.length === 0 && Number.isFinite(Number(payload.frameStepMs)) && Number(payload.frameStepMs) > 0) {
      const frameStepMs = Math.max(1, Number(payload.frameStepMs));
      const startMs = Math.max(0, Number(payload.startMs) || 0);
      const endMs = Math.max(startMs, Math.min(durationMs || startMs, Number.isFinite(Number(payload.endMs)) ? Number(payload.endMs) : durationMs));
      sampleTimes = [];
      for (let atMs = startMs; atMs <= endMs && sampleTimes.length < maxFrameSamples; atMs += frameStepMs) {
        sampleTimes.push(Math.min(endMs, Math.round(atMs)));
      }
    }
    if (mode === 'video' && sampleTimes.length > maxFrameSamples) {
      sampleTimes = sampleTimes.slice(0, maxFrameSamples);
    }
    const buildReviewDataUrl = (canvas) => {
      const maxSide = 960;
      const width = Math.max(1, Number(canvas?.width) || 1);
      const height = Math.max(1, Number(canvas?.height) || 1);
      const scale = Math.min(1, maxSide / Math.max(width, height));
      if (scale >= 0.999) return canvas.toDataURL('image/jpeg', 0.78);
      const reviewCanvas = document.createElement('canvas');
      reviewCanvas.width = Math.max(1, Math.round(width * scale));
      reviewCanvas.height = Math.max(1, Math.round(height * scale));
      const ctx = reviewCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, 0, reviewCanvas.width, reviewCanvas.height);
      return reviewCanvas.toDataURL('image/jpeg', 0.78);
    };
    const renderOne = async (atMsValue) => {
      if (mode === 'video' && Number.isFinite(Number(atMsValue))) {
        context.setCreativeTimelinePosition(Number(atMsValue), { render: false, persist: false });
      }
      context.renderCreativeWorkspace();
      await context.waitForCreativeExportPaint(1);
      await context.syncCreativeVideoElementsToTimeline({ atMs: mode === 'video' ? Number(atMsValue ?? previousTimeline) : context.creativeTimelineMs });
      const canvas = await context.renderCreativeExportCanvas('png');
      return {
        width: canvas.width,
        height: canvas.height,
        atMs: mode === 'video' ? Number(atMsValue ?? previousTimeline) : null,
        mimeType: 'image/jpeg',
        dataUrl: includeDataUrl ? buildReviewDataUrl(canvas) : '',
      };
    };
    const snapshots = sampleTimes.length
      ? []
      : [await renderOne(Number.isFinite(Number(payload.atMs)) ? Number(payload.atMs) : previousTimeline)];
    for (const atMs of sampleTimes) {
      snapshots.push(await renderOne(atMs));
    }
    if (mode === 'video') {
      context.setCreativeTimelinePosition(previousTimeline, { render: false, persist: false });
      context.renderCreativeWorkspace();
    }
    const first = snapshots[0] || {};
    data = {
      width: first.width || 0,
      height: first.height || 0,
      atMs: first.atMs ?? null,
      sampleCount: snapshots.length,
      sampleEveryFrame: payload.sampleEveryFrame === true,
      truncated: mode === 'video' && (
        (Array.isArray(payload.sampleTimesMs) && payload.sampleTimesMs.length > snapshots.length)
        || (payload.sampleEveryFrame === true && durationMs > 0 && snapshots.length >= maxFrameSamples)
      ),
      maxFrameSamples,
      frames: snapshots.map(({ width, height, atMs }) => ({ width, height, atMs })),
    };
    context.sendCreativeCommandResult(message, {
      success: true,
      data,
      snapshot: snapshots.length === 1 ? snapshots[0] : null,
      snapshots,
    });
    return;
    } else if (command === 'export') {
      const format = String(payload.format || '').trim().toLowerCase();
      if (!format) throw new Error('export requires format.');
      if (mode === 'video' && context.creativeHtmlMotionClip && format === 'mp4') {
        data = await context.exportCreativeHtmlMotionClip(payload);
        context.sendCreativeCommandResult(message, { success: true, data });
        return;
      }
      const preExportValidation = context.validateCreativeSceneLayout(context.creativeSceneDoc, { mode });
      if (!preExportValidation.ok && payload.force !== true) {
        throw new Error(`Creative layout validation blocked export: ${preExportValidation.issues.slice(0, 3).map((issue) => issue.message).join('; ')}`);
      }
      const exportResult = await context.canvasExportCreative(format, { skipDownload: payload.download !== true, workspaceOnly: payload.workspaceOnly !== false });
      data = { format, activeExport: context.creativeActiveExport || null, export: exportResult || null, preExportValidation };
  } else if (command === 'save_scene') {
    data = await context.canvasSaveCreativeSceneSnapshot({ filename: payload.filename });
  } else if (command === 'composition_get') {
    const comp = context.ensureCreativeComposition();
    data = { composition: comp, summary: comp ? context.summarizeComposition(comp) : null };
  } else if (command === 'composition_add_track') {
    const comp = context.ensureCreativeComposition();
    if (!comp) throw new Error('Composition not available.');
    const kind = String(payload.kind || 'video').trim().toLowerCase();
    if (!['video', 'audio', 'caption'].includes(kind)) throw new Error('kind must be video, audio, or caption');
    const track = context.compositionAddTrack(comp, kind, payload.label);
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { track, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_add_clip') {
    const comp = context.ensureCreativeComposition();
    if (!comp) throw new Error('Composition not available.');
    const clip = context.compositionAddClip(comp, payload || {});
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { clip, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_move_clip') {
    const comp = context.ensureCreativeComposition();
    const clip = context.compositionMoveClip(comp, payload.clipId, payload || {});
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { clip, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_trim_clip') {
    const comp = context.ensureCreativeComposition();
    const clip = context.compositionTrimClip(comp, payload.clipId, payload.edge, payload.toMs);
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { clip, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_split_at') {
    const comp = context.ensureCreativeComposition();
    const result = context.compositionSplitClip(comp, payload.clipId, Number(payload.atMs) || 0);
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { left: result.left, right: result.right, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_delete_clip') {
    const comp = context.ensureCreativeComposition();
    const removed = context.compositionDeleteClip(comp, payload.clipId, { ripple: payload.ripple === true });
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { removed, summary: context.summarizeComposition(comp) };
  } else if (command === 'composition_set_transition') {
    const comp = context.ensureCreativeComposition();
    const clip = context.compositionSetTransition(comp, payload.clipId, payload.edge, payload.transition || null);
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { clip };
  } else if (command === 'composition_select_clip') {
    const comp = context.ensureCreativeComposition();
    if (!comp) throw new Error('Composition not available.');
    const clipId = payload.clipId == null ? null : String(payload.clipId);
    if (clipId !== null && !comp.clips.find((c) => c.id === clipId)) throw new Error(`Unknown clipId: ${clipId}`);
    comp.selectedClipId = clipId;
    context.persistCompositionState();
    context.renderCreativeWorkspace?.();
    data = { selectedClipId: clipId };
  } else if (command === 'composition_lint') {
    const comp = context.ensureCreativeComposition();
    data = context.compositionLint(comp);
  } else if (command === 'composition_save') {
    const comp = context.ensureCreativeComposition();
    if (!comp) throw new Error('Composition not available.');
    const sid = context.window.currentChatSessionId || 'default';
    const root = (context.window.canvasProjectRoot || '').toString();
    const filename = String(payload.filename || '').trim();
    const response = await fetch('/api/canvas/composition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        root,
        mode,
        composition: comp,
        ...(filename ? { filename } : {}),
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) throw new Error(json?.error || `HTTP ${response.status}`);
    data = { path: json.path, absPath: json.absPath, summary: json.summary };
  } else if (command === 'composition_render') {
    const comp = context.ensureCreativeComposition();
    if (!comp) throw new Error('Composition not available.');
    const sid = context.window.currentChatSessionId || 'default';
    const root = (context.window.canvasProjectRoot || '').toString();
    const format = String(payload.format || 'mp4').toLowerCase();
    const filename = String(payload.filename || '').trim();
    const response = await fetch('/api/canvas/composition/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        root,
        composition: comp,
        format,
        ...(filename ? { filename } : {}),
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) throw new Error(json?.error || `HTTP ${response.status}`);
    data = {
      path: json.path,
      absPath: json.absPath,
      format: json.format,
      durationMs: json.durationMs,
      width: json.width,
      height: json.height,
      frameRate: json.frameRate,
      clipCount: json.clipCount,
      audioTrackCount: json.audioTrackCount,
      elapsedMs: json.elapsedMs,
    };
  } else {
    throw new Error(`Unknown creative command: ${command}`);
  }

    context.sendCreativeCommandResult(message, { success: true, data });
  } finally {
    context.window.__pmSuppressCreativeAutoOpen = previousSuppress;
    if (backgroundCommand && previousActiveSessionId && context.getChatSessionById(previousActiveSessionId)) {
      context.window.activeChatSessionId = previousActiveSessionId;
      if (previousAgentSessionId) context.setAgentSessionId(previousAgentSessionId);
      else context.setAgentSessionId(previousActiveSessionId);
      context.window.currentCreativeMode = previousCreativeMode;
      context.syncActiveChat();
      if (typeof context.window.renderSessionsList === 'function') context.window.renderSessionsList();
      if (typeof context.window.renderChatMessages === 'function') context.window.renderChatMessages();
      if (context.canvasOpen) context.toggleCanvas(false, { force: true });
    }
  }
}
