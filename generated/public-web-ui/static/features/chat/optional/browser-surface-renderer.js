// Browser canvas DOM owner. Loaded only after browser state becomes active.

export function renderBrowserCanvasSurface(context) {
  const state = context.getBrowserCanvasState();
  const mode = context.normalizeBrowserInteractionMode(state.interactionMode);
  const designMode = context.isBrowserDesignMode(state);
  const meta = context.getBrowserInteractionMeta(mode);
  const selectedKey = context.getSelectedBrowserElementKey(state.selectedElement);
  if (selectedKey && state.elementNameDraftKey !== selectedKey) {
    state.elementNameDraftKey = selectedKey;
    state.elementNameDraft = context.suggestBrowserElementName(state.selectedElement);
  } else if (!selectedKey && state.elementNameDraftKey) {
    state.elementNameDraftKey = '';
    state.elementNameDraft = '';
  }
  const urlEl = document.getElementById('browser-canvas-url');
  const stageTitle = document.getElementById('browser-canvas-stage-title');
  const stageCopy = document.getElementById('browser-canvas-stage-copy');
  const emptyState = document.getElementById('browser-canvas-empty');
  const frameWrap = document.getElementById('browser-canvas-frame-wrap');
  const frameEl = document.getElementById('browser-canvas-frame');
  const frameMeta = document.getElementById('browser-canvas-frame-meta');
  const frameCaption = document.getElementById('browser-canvas-frame-caption');
  const frameSize = document.getElementById('browser-canvas-frame-size');
  const selectionBox = document.getElementById('browser-canvas-selection-box');
  const clickHighlight = document.getElementById('browser-canvas-click-highlight');
  const agentCursor = document.getElementById('browser-canvas-agent-cursor');
  const selectionCard = document.getElementById('browser-canvas-selection-card');
  const annotationsEl = document.getElementById('browser-canvas-annotations');
  const selectionLabel = document.getElementById('browser-canvas-selection-label');
  const selectionText = document.getElementById('browser-canvas-selection-text');
  const modeTitleEl = document.getElementById('browser-canvas-mode-title');
  const backBtn = document.getElementById('browser-canvas-back-btn');
  const forwardBtn = document.getElementById('browser-canvas-forward-btn');
  const reloadBtn = document.getElementById('browser-canvas-reload-btn');
  const openBtn = document.getElementById('browser-canvas-open-btn');
  const addressInput = document.getElementById('browser-canvas-address-input');
  const namePanel = document.getElementById('browser-canvas-name-panel');
  const nameInput = document.getElementById('browser-canvas-name-input');
  const savedWrap = document.getElementById('browser-canvas-saved-elements');
  const sessionEl = document.getElementById('browser-canvas-session');
  const pageTitleEl = document.getElementById('browser-canvas-page-title');
  const lastToolEl = document.getElementById('browser-canvas-last-tool');
  const lastUpdatedEl = document.getElementById('browser-canvas-last-updated');
  const modeCopyEl = document.getElementById('browser-canvas-mode-copy');
  const taskPanel = document.getElementById('browser-canvas-task-panel');
  const taskCopyEl = document.getElementById('browser-canvas-task-copy');
  const teachPanel = document.getElementById('browser-canvas-teach-panel');
  const teachStatusEl = document.getElementById('browser-canvas-teach-status');
  const teachStartBtn = document.getElementById('browser-canvas-teach-start-btn');
  const teachCompleteBtn = document.getElementById('browser-canvas-teach-complete-btn');
  const teachCancelBtn = document.getElementById('browser-canvas-teach-cancel-btn');
  const teachApprovalActions = document.getElementById('browser-canvas-teach-approval-actions');
  const teachStopStepInput = document.getElementById('browser-canvas-teach-stop-step-input');
  const teachPendingCard = document.getElementById('browser-canvas-teach-pending');
  const teachPendingTitle = document.getElementById('browser-canvas-teach-pending-title');
  const teachPendingCopy = document.getElementById('browser-canvas-teach-pending-copy');
  const teachContinueBtn = document.getElementById('browser-canvas-teach-continue-btn');
  const teachDiscardBtn = document.getElementById('browser-canvas-teach-discard-btn');
  const teachStepsWrap = document.getElementById('browser-canvas-teach-steps');
  const visibleSessionId = context.getBrowserCanvasVisibleSessionId();
  const visibleRecord = context.getBrowserSessionRecord(visibleSessionId, state);
  const visibleTaskPrompt = String(visibleRecord?.browserTaskPrompt || '').trim();
  if (taskPanel) taskPanel.style.display = visibleTaskPrompt ? 'block' : 'none';
  // Sidebar order: (1) Task when watching a subagent, (2) Mode Notes, (3) Selected element, (4) Last Tool Call.
  if (modeTitleEl && sessionEl && selectionCard) {
    const modeCard = modeTitleEl.parentElement;
    const lastToolCard = sessionEl.closest('div[style*="border"]') || sessionEl.parentElement;
    const sidebar = lastToolCard?.parentElement;
    if (sidebar && modeCard && lastToolCard) {
      if (taskPanel && taskPanel.style.display !== 'none') {
        if (sidebar.firstElementChild !== taskPanel) sidebar.insertBefore(taskPanel, sidebar.firstElementChild);
        if (taskPanel.nextElementSibling !== modeCard) sidebar.insertBefore(modeCard, taskPanel.nextElementSibling);
      } else if (sidebar.firstElementChild !== modeCard) {
        sidebar.insertBefore(modeCard, sidebar.firstElementChild);
      }
      if (modeCard.nextElementSibling !== selectionCard) sidebar.insertBefore(selectionCard, modeCard.nextElementSibling);
      if (selectionCard.nextElementSibling !== lastToolCard) sidebar.insertBefore(lastToolCard, selectionCard.nextElementSibling);
    }
  }
  if (teachPendingCard && modeTitleEl) {
    const modeCard = modeTitleEl.parentElement;
    if (modeCard && (teachPendingCard.parentElement !== modeCard || modeCard.firstElementChild !== teachPendingCard)) {
      modeCard.insertBefore(teachPendingCard, modeCard.firstElementChild);
    }
    teachPendingCard.style.marginTop = '0';
    teachPendingCard.style.marginBottom = '12px';
  }
  const nativeProvider = context.isBrowserCanvasInHouseProvider(state);
  const hasFrame = !!String(state.frameBase64 || '').trim();
  const hasVisualSurface = hasFrame || (nativeProvider && state.active);
  const controlCaptured = state.controlCaptured === true && state.controlOwner === 'user';
  const followingDetachedSession = context.isFollowingDetachedBrowserCanvasSession(state);
  const restoreHint = context.getBrowserCanvasRestoreHint(state);
  const canReopenLastPage = !followingDetachedSession && context.isRestorableBrowserCanvasUrl(restoreHint.restoreUrl);
  const teach = context.getBrowserTeachSession(state);
  const teachActive = context.hasActiveBrowserTeachSession(state);
  const teachRecording = context.isBrowserTeachRecording(state);
  const teachAwaitingApproval = context.isBrowserTeachAwaitingApproval(state);
  const teachVerified = context.isBrowserTeachVerified(state);
  const pendingTeachStep = teach.pendingStep && typeof teach.pendingStep === 'object' ? teach.pendingStep : null;
  const recordedTeachSteps = Array.isArray(teach.steps) ? teach.steps : [];
  const teachVerification = teachVerified && teach.verification && typeof teach.verification === 'object' ? teach.verification : null;
  const streamDescriptor = state.streamActive
    ? `${String(state.streamTransport || 'stream').toUpperCase()} live`
    : (nativeProvider && state.active ? 'NATIVE live' : '');

  context.ensureBrowserCanvasControlBindings();
  context.ensureBrowserCanvasGlobalControlBindings();
  context.renderNativeBrowserTabs(state, nativeProvider);
  if (urlEl) urlEl.textContent = state.url || restoreHint.restoreUrl || 'No active browser session';
  if (addressInput && document.activeElement !== addressInput) {
    addressInput.value = state.url || restoreHint.restoreUrl || '';
    addressInput.placeholder = state.active ? 'Search or enter URL' : 'Open a URL...';
  }
  [backBtn, forwardBtn, reloadBtn, openBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !state.active && btn !== openBtn;
    btn.style.opacity = btn.disabled ? '0.45' : '1';
    btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
  });
  if (stageTitle) {
    stageTitle.textContent = state.active
      ? (state.title || state.url || 'Browser session active')
      : 'Browser canvas is standing by';
  }
  if (stageCopy) {
    stageCopy.textContent = state.active
      ? (followingDetachedSession
        ? `Teach verification is running in a detached browser tab so your original page stays intact. You can watch it here, then jump back to the main tab whenever you want.`
         : (designMode
           ? 'Design mode lets you hover, select, annotate, and send a selected browser element to the chat.'
           : `${meta.label} mode is active for this browser session. ${state.lastTool ? `Last tool: ${state.lastTool}.` : ''}`))
      : 'When Prometheus opens or updates a browser session, the browser canvas will follow it here and keep the current session, page title, and interaction mode in sync.';
  }
  if (sessionEl) {
    const fullLastTool = followingDetachedSession
      ? `Following verifier session ${visibleSessionId}`
      : (state.lastTool || 'No browser tools used yet');
    sessionEl.textContent = context.truncateBrowserPreview(fullLastTool, 80);
    sessionEl.title = fullLastTool;
    sessionEl.style.wordBreak = 'break-word';
  }
  if (pageTitleEl) {
    pageTitleEl.textContent = state.active
      ? (state.title || state.url || 'Browser session active')
      : 'Open a site with the browser tools to wake this surface up.';
  }
  if (lastToolEl) {
    if (state.streamActive) lastToolEl.textContent = `${state.statusLabel || 'Browser active'} · ${streamDescriptor}`;
    else if (state.statusLabel) lastToolEl.textContent = state.statusLabel;
    else lastToolEl.textContent = state.active ? 'Browser active' : 'Browser idle';
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = context.formatBrowserCanvasTimestamp(
      state.streamActive && state.streamLastFrameAt ? state.streamLastFrameAt : state.updatedAt,
    );
  }
  if (taskPanel) taskPanel.style.display = visibleTaskPrompt ? 'block' : 'none';
  if (taskCopyEl) {
    taskCopyEl.textContent = visibleTaskPrompt || '';
    taskCopyEl.title = visibleTaskPrompt;
  }
  context.updateBrowserAgentCursorOverlay(agentCursor, frameEl, state);
  const showTeachNaming = mode === 'teach' && !!state.selectedElement && !followingDetachedSession;
  if (modeTitleEl) {
    if (mode === 'teach' && pendingTeachStep) modeTitleEl.textContent = 'Confirm This Step';
    else if (mode === 'teach' && showTeachNaming) modeTitleEl.textContent = 'Name This Element';
    else if (mode === 'teach' && teachAwaitingApproval) modeTitleEl.textContent = 'Teach Review';
    else if (mode === 'teach' && teachVerified) modeTitleEl.textContent = 'Teach Verification';
    else if (mode === 'teach' && teachActive) modeTitleEl.textContent = 'Teach Session';
    else if (designMode) modeTitleEl.textContent = 'Design Mode';
    else modeTitleEl.textContent = 'Mode Notes';
  }
  if (modeCopyEl) {
    if (mode === 'teach' && pendingTeachStep) {
      modeCopyEl.textContent = 'Teach pauses each step before it reaches the live browser. Rename, save, or discard anything you want, then continue when the step looks right.';
    } else if (mode === 'teach' && showTeachNaming) {
      modeCopyEl.textContent = 'Give this element a name you would naturally use later. Prometheus will keep it as reusable browser memory for this site.';
    } else if (mode === 'teach' && teachAwaitingApproval) {
      modeCopyEl.textContent = 'The workflow is recorded. Prometheus will summarize it, flag risky steps, and ask how far you want verification to go before it runs anything.';
    } else if (mode === 'teach' && teachVerified) {
      modeCopyEl.textContent = 'Prometheus has replayed the taught workflow. The next response should explain what happened, what the workflow appears to be for, and ask you to confirm that understanding before anything gets packaged.';
    } else if (mode === 'teach' && teachActive) {
      modeCopyEl.textContent = 'Teach mode is capturing a reusable workflow. Start from the current page, stage each step, and keep the log clean enough for Prometheus to replay later.';
    } else if (designMode) {
      modeCopyEl.textContent = 'Hover to highlight page elements. Click one to inspect it, add it to a multi-selection, or chat with Prometheus about what should change.';
    } else {
      modeCopyEl.textContent = meta.copy;
    }
  }
  // Browser-mode layout: the live browser owns the canvas below the outer mode
  // header. Teach keeps its workflow controls; Agent, Co-pilot, and Design use
  // the full-width native surface.
  const sideCol = document.getElementById('browser-canvas-side-col');
  const browserLayoutGrid = document.getElementById('browser-canvas-layout');
  const showSidePanels = mode === 'teach';
  if (sideCol) sideCol.style.display = showSidePanels ? 'flex' : 'none';
  // The grid columns are governed by a CSS rule keyed on this attribute because
  // #browser-canvas-layout sets grid-template-columns with !important, which an
  // inline style cannot override. data-side-panels="0" collapses to one column.
  if (browserLayoutGrid) browserLayoutGrid.dataset.sidePanels = showSidePanels ? '1' : '0';
  if (namePanel) namePanel.style.display = showTeachNaming ? 'block' : 'none';
  if (nameInput && nameInput.value !== state.elementNameDraft) nameInput.value = state.elementNameDraft || '';
  if (teachPanel) teachPanel.style.display = mode === 'teach' ? 'block' : 'none';
  if (teachStatusEl) {
    if (!teachActive) {
      teachStatusEl.textContent = state.active
        ? 'Capture the current page as the starting point, then stage each browser action one step at a time.'
        : 'Open a browser session first, then start Teach mode from the page you want to teach.';
    } else if (teachRecording) {
      teachStatusEl.textContent = `Recording from ${teach.startTitle || teach.startUrl || 'the current page'} with ${recordedTeachSteps.length} confirmed step${recordedTeachSteps.length === 1 ? '' : 's'}.`;
    } else if (teachAwaitingApproval) {
      teachStatusEl.textContent = `Recorded ${recordedTeachSteps.length} step${recordedTeachSteps.length === 1 ? '' : 's'} from ${teach.startTitle || teach.startUrl || 'the starting page'}. Waiting for verification approval.`;
    } else if (teachVerified && teachVerification) {
      const label = String(teachVerification.status || 'verified').trim().toLowerCase();
      const readable = label === 'partial' ? 'completed with issues' : (label === 'failed' ? 'failed' : 'passed');
      teachStatusEl.textContent = `Verification ${readable}. Prometheus should now summarize what happened and ask you to confirm what this workflow is for before creating anything reusable.`;
    } else {
      teachStatusEl.textContent = 'Teach mode is ready.';
    }
  }
  if (teachStartBtn) {
    teachStartBtn.textContent = teachAwaitingApproval ? 'Resume Recording' : (teachActive ? 'Restart Teach' : 'Start Teach');
    teachStartBtn.style.display = teachRecording ? 'none' : 'inline-flex';
    teachStartBtn.disabled = !state.active;
    teachStartBtn.style.opacity = state.active ? '1' : '0.55';
  }
  if (teachCompleteBtn) {
    teachCompleteBtn.style.display = teachRecording ? 'inline-flex' : 'none';
    teachCompleteBtn.disabled = !teachRecording || !!pendingTeachStep || !!teach.executingStepId || recordedTeachSteps.length === 0;
    teachCompleteBtn.style.opacity = teachCompleteBtn.disabled ? '0.55' : '1';
  }
  if (teachCancelBtn) teachCancelBtn.style.display = teachActive ? 'inline-flex' : 'none';
  if (teachApprovalActions) teachApprovalActions.style.display = teachAwaitingApproval ? 'block' : 'none';
  if (teachStopStepInput) {
    const maxSteps = Math.max(1, recordedTeachSteps.length || 1);
    teachStopStepInput.max = String(maxSteps);
    if (!teachAwaitingApproval) teachStopStepInput.value = '';
  }
  if (teachPendingCard) teachPendingCard.style.display = mode === 'teach' && pendingTeachStep ? 'block' : 'none';
  if (teachPendingTitle) {
    teachPendingTitle.textContent = pendingTeachStep
      ? (pendingTeachStep.summary || pendingTeachStep.title || 'Pending teach step')
      : 'No pending teach step';
  }
  if (teachPendingCopy) {
    const toolPreviewFull = pendingTeachStep?.toolPreview || pendingTeachStep?.toolName || 'browser step';
    const selectorFull = pendingTeachStep?.selection?.selector || pendingTeachStep?.selection?.text || pendingTeachStep?.pageUrl || 'Use Continue to send this step to the browser.';
    teachPendingCopy.innerHTML = pendingTeachStep
      ? `<div style="font-size:11px;color:#f8fafc;font-weight:700;word-break:break-word" title="${context.escHtml(toolPreviewFull)}">${context.escHtml(context.truncateBrowserPreview(toolPreviewFull, 70))}</div>
         <div style="margin-top:6px;font-size:11px;line-height:1.6;color:#cbd5e1;word-break:break-word" title="${context.escHtml(selectorFull)}">${context.escHtml(context.truncateBrowserPreview(selectorFull, 80))}</div>
         ${pendingTeachStep.risk === 'high' ? '<div style="margin-top:8px;font-size:10px;font-weight:700;color:#fca5a5;letter-spacing:0.04em;text-transform:uppercase">Risky step</div>' : ''}`
      : 'Stage a click, scroll, shortcut, or text input to see it here before it runs.';
  }
  if (teachContinueBtn) teachContinueBtn.style.display = pendingTeachStep ? 'inline-flex' : 'none';
  if (teachDiscardBtn) teachDiscardBtn.style.display = pendingTeachStep ? 'inline-flex' : 'none';
  if (teachStepsWrap) {
    if (mode === 'teach' && recordedTeachSteps.length) {
      teachStepsWrap.style.display = 'block';
      teachStepsWrap.innerHTML = `
        <div style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8">Teach Steps</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          ${recordedTeachSteps.map((step, idx) => {
            const stepId = String(step?.id || '').trim();
            const status = String(step?.status || 'recorded').trim().toLowerCase();
            const statusColor = status === 'error' ? '#fca5a5' : (status === 'executing' ? '#fde68a' : '#86efac');
            const removeAttr = JSON.stringify(stepId);
            return `
              <div style="border:1px solid rgba(148,163,184,0.14);border-radius:8px;padding:10px;background:rgba(15,23,42,0.42)">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                  <div style="min-width:0">
                    <div style="font-size:12px;font-weight:800;color:#f8fafc;word-break:break-word">${context.escHtml(`${idx + 1}. ${step.summary || step.title || step.toolName || 'Teach step'}`)}</div>
                    <div style="margin-top:5px;font-size:11px;color:#93c5fd;word-break:break-word">${context.escHtml(step.toolPreview || step.toolName || 'browser step')}</div>
                  </div>
                  <button onclick="removeBrowserTeachStep(${removeAttr})" style="display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(248,113,113,0.2);background:rgba(248,113,113,0.08);color:#fda4af;border-radius:8px;padding:5px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Manrope',sans-serif;flex-shrink:0">Remove</button>
                </div>
                <div style="margin-top:8px;font-size:10px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:${statusColor}">${context.escHtml(status.replace(/_/g, ' '))}${step.risk === 'high' ? ' · high risk' : ''}</div>
                ${step.resultSummary ? `<div style="margin-top:6px;font-size:11px;line-height:1.6;color:#cbd5e1;word-break:break-word">${context.escHtml(step.resultSummary)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      teachStepsWrap.style.display = 'none';
      teachStepsWrap.innerHTML = '';
    }
  }
  if (savedWrap) {
    const saved = Array.isArray(state.namedElements) ? state.namedElements : [];
    const itemRoots = Array.isArray(state.itemRoots) ? state.itemRoots : [];
    const extractionSchemas = Array.isArray(state.extractionSchemas) ? state.extractionSchemas : [];
    if (saved.length || itemRoots.length || extractionSchemas.length) {
      savedWrap.style.display = 'block';
      const renderMemoryList = (title, items, accentColor = '#93c5fd') => `
        <div style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8">${context.escHtml(title)}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          ${items.map((entry) => {
            const fullSelector = entry.selector || entry.tagName || 'element';
            const truncatedSelector = fullSelector.length > 60
              ? fullSelector.substring(0, 60) + '...'
              : fullSelector;
            return `
            <div style="border:1px solid rgba(148,163,184,0.14);border-radius:8px;padding:8px 10px;background:rgba(15,23,42,0.42)">
              <div style="font-size:12px;font-weight:700;color:#f8fafc;word-break:break-word">${context.escHtml(entry.name)}</div>
              <div style="margin-top:4px;font-size:11px;color:${accentColor};word-break:break-word;font-family:monospace;font-size:10px" title="${context.escHtml(fullSelector)}">${context.escHtml(truncatedSelector)}</div>
            </div>
          `;
          }).join('')}
        </div>
      `;
      const renderSchemaList = (title, items) => `
        <div style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8">${context.escHtml(title)}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          ${items.map((entry) => {
            const fields = entry?.fields && typeof entry.fields === 'object' ? Object.keys(entry.fields) : [];
            const detailBits = [
              entry.itemRoot ? `root: ${entry.itemRoot}` : '',
              entry.dedupeKey ? `dedupe: ${entry.dedupeKey}` : '',
              entry.limit ? `limit: ${entry.limit}` : '',
            ].filter(Boolean);
            return `
              <div style="border:1px solid rgba(148,163,184,0.14);border-radius:8px;padding:8px 10px;background:rgba(15,23,42,0.42)">
                <div style="font-size:12px;font-weight:700;color:#f8fafc;word-break:break-word">${context.escHtml(entry.name)}</div>
                <div style="margin-top:4px;font-size:11px;color:#67e8f9;word-break:break-word">${context.escHtml(fields.join(', ') || 'No fields')}</div>
                ${detailBits.length ? `<div style="margin-top:4px;font-size:10px;color:#94a3b8;word-break:break-word">${context.escHtml(detailBits.join(' • '))}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
      savedWrap.innerHTML = `
        ${saved.length ? renderMemoryList('Saved Elements For This Site', saved, '#93c5fd') : ''}
        ${saved.length && (itemRoots.length || extractionSchemas.length) ? '<div style="height:12px"></div>' : ''}
        ${itemRoots.length ? renderMemoryList('Saved Item Roots For This Site', itemRoots, '#c4b5fd') : ''}
        ${itemRoots.length && extractionSchemas.length ? '<div style="height:12px"></div>' : ''}
        ${extractionSchemas.length ? renderSchemaList('Saved Extraction Schemas For This Site', extractionSchemas) : ''}
      `;
    } else {
      savedWrap.style.display = 'none';
      savedWrap.innerHTML = '';
    }
  }
  if (frameWrap) frameWrap.style.display = hasVisualSurface ? 'flex' : 'none';
  if (emptyState) emptyState.style.display = hasVisualSurface ? 'none' : 'block';
  if (frameEl) {
    frameEl.style.display = nativeProvider ? 'none' : 'block';
    frameEl.style.cursor = designMode
      ? (followingDetachedSession ? 'default' : 'crosshair')
      : mode === 'teach'
      ? (followingDetachedSession ? 'default' : 'crosshair')
      : (mode === 'copilot' ? ((controlCaptured && !followingDetachedSession) ? 'text' : 'pointer') : 'default');
  }
  if (frameEl && hasFrame) {
    // Prefer object-URL transport: each new frame is decoded once (no base64 string churn,
    // no data-URL re-parse). The blob URL is created in the WS handler and revoked
    // when superseded, so we just point the <img> at the current one here.
    if (state.frameBlobUrl) {
      if (frameEl.dataset.frameBlobUrl !== state.frameBlobUrl) {
        frameEl.src = state.frameBlobUrl;
        frameEl.dataset.frameBlobUrl = state.frameBlobUrl;
      }
    } else if (state.frameBase64) {
      const mime = String(state.frameFormat || 'png').toLowerCase() === 'jpeg' ? 'image/jpeg' : 'image/png';
      frameEl.src = `data:${mime};base64,${state.frameBase64}`;
      frameEl.dataset.frameBlobUrl = '';
    }
  }
  if (frameMeta) frameMeta.style.display = nativeProvider && state.active ? 'none' : (hasVisualSurface ? 'flex' : 'none');
  if (frameCaption) {
    frameCaption.textContent = nativeProvider && state.active
      ? 'Prometheus in-house browser'
      : (state.streamActive
      ? `${streamDescriptor} browser feed`
      : (state.title || state.url || 'Latest browser frame'));
  }
  if (frameSize) {
    const width = Number(state.frameWidth || 0);
    const height = Number(state.frameHeight || 0);
    frameSize.textContent = nativeProvider && state.active
      ? 'Native Electron surface'
      : (width > 0 && height > 0 ? `${width} × ${height}` : 'Viewport frame');
  }
  const annotationSelections = designMode
    ? context.getBrowserDesignAnnotationSelections(state)
    : (mode === 'teach' && state.selectedElement ? [context.cloneBrowserDesignSelection(state.selectedElement)].filter(Boolean) : []);
  if (selectionCard) selectionCard.style.display = ((mode === 'teach' || designMode) && annotationSelections.length && !followingDetachedSession && !nativeProvider) ? 'block' : 'none';
  if (annotationsEl) {
    annotationsEl.style.display = annotationSelections.length ? 'flex' : 'none';
    annotationsEl.innerHTML = annotationSelections.map((annotation, index) => {
      const selector = annotation.selector
        || (annotation.id ? `#${annotation.id}` : '')
        || annotation.tagName
        || 'element';
      const summary = context.summarizeBrowserTeachTarget(annotation, state);
      return `<div class="browser-canvas-annotation-row">
        <span class="browser-canvas-annotation-index">Annotation ${index + 1}</span>
        <strong title="${context.escHtml(summary)}">${context.escHtml(context.truncateBrowserPreview(summary, 72))}</strong>
        <small title="${context.escHtml(selector)}">${context.escHtml(context.truncateBrowserPreview(selector, 96))}</small>
      </div>`;
    }).join('');
  }
  if (frameSize && state.streamActive) {
    const width = Number(state.frameWidth || 0);
    const height = Number(state.frameHeight || 0);
    if (width > 0 && height > 0) {
      frameSize.textContent = `${width} x ${height} · ${String(state.streamFocus || 'passive')}`;
    }
  }
  if (selectionLabel) {
    selectionLabel.textContent = annotationSelections.length
      ? `${annotationSelections.length} annotation${annotationSelections.length === 1 ? '' : 's'} attached`
      : 'No annotation selected';
  }
  if (selectionText) {
    const fullSelectorText = annotationSelections.length
      ? (annotationSelections.length > 1
        ? `${annotationSelections.length} browser annotations are attached to the next chat turn.`
        : (annotationSelections[0].selector || (annotationSelections[0].id ? `#${annotationSelections[0].id}` : annotationSelections[0].tagName || 'element')))
       : (designMode
         ? 'Hover over the live browser frame and click an element to open its Design actions.'
         : 'Enter Teach mode and click the live browser frame to capture a real page element.');
    selectionText.textContent = annotationSelections.length ? context.truncateBrowserPreview(fullSelectorText, 120) : fullSelectorText;
    selectionText.title = fullSelectorText;
  }
  const stageEl = frameEl?.parentElement || document.getElementById('browser-canvas-frame-stage');
  const nativeSurfaceActive = nativeProvider && state.active;
  const nativeSurfaceValue = nativeSurfaceActive ? '1' : '0';
  if (stageEl) stageEl.dataset.nativeBrowserSurface = nativeSurfaceValue;
  if (frameWrap) frameWrap.dataset.nativeBrowserSurface = nativeSurfaceValue;
  const liveCard = document.getElementById('browser-canvas-live-card');
  if (liveCard) liveCard.dataset.nativeBrowserSurface = nativeSurfaceValue;
  const layoutGrid = document.getElementById('browser-canvas-layout');
  if (layoutGrid) layoutGrid.dataset.nativeBrowserSurface = nativeSurfaceValue;
  context.syncBrowserCanvasFrameLayout(frameWrap, frameMeta, frameEl);
  context.ensureBrowserCanvasHoverBindings();
  context.ensureBrowserCanvasFrameMetaResizeObserver(frameWrap, frameMeta, frameEl);
  context.updateBrowserSelectionOverlay(selectionBox, frameEl, state);
  context.updateBrowserTransientHighlight(clickHighlight, frameEl, state);
  context.updateBrowserHoverOverlay();
  context.syncBrowserCanvasStream();
  context.queueNativeBrowserSurfaceSync();
  context.syncNativeBrowserTeachCapture(state);
  context.syncNativeBrowserDesignMode(state);
  context.updateDesignSelectionChip();
  context.updateCreativeModeControls();
  const miniSources = document.getElementById('sources-minimized-panel');
  if (miniSources?.classList.contains('is-visible')) context.renderSourcesMinimizedPanel();
}
