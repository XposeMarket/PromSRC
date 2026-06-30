/**
 * SubagentsPage.js — Standalone subagent management
 *
 * Shows all standalone (non-team) subagents in a card grid.
 * Click an agent to open a detail panel with Overview, System Prompt, Runs, and Chat tabs.
 */

import { api } from '../api.js';
import { escHtml, bgtToast, timeAgo, showToast } from '../utils.js';
import { wsEventBus } from '../ws.js';
import { renderAgentModelPicker as _renderAgentModelPicker, agentModelPickerHydrate, registerAgentModelPickerOnSaved } from '../components/agent-model-picker.js';
import { renderAgentVoicePicker as _renderAgentVoicePicker, agentVoicePickerHydrate, registerAgentVoicePickerOnSaved } from '../components/agent-voice-picker.js';

// ── State ─────────────────────────────────────────────────────────────────────
let subagentsData = [];          // All standalone agents (not team members)
let activeSubagentId = null;     // Currently open detail panel
let subagentDetailTab = 'overview'; // overview | systemprompt | memory | heartbeat | runs | chat
let subagentRuns = [];
let activeSubagentRunId = '';
let subagentRunDetails = {};
let subagentChatHistory = [];    // [{ id, role:'user'|'agent'|'system', content, ts, metadata }]
let subagentChatDraft = '';
let _subagentChatSending = false;
let _subagentDetailPolling = null;
let subagentStreamingState = null; // { agentId, content, thinking, processEntries, progressLines, completed, finalReply, fallbackTimer }
let subagentStreamingStateByAgent = {}; // agentId -> live chat stream state
const MAX_SUBAGENT_CHAT_QUEUE = 8;
let subagentChatAbortControllers = {}; // agentId -> AbortController
let subagentChatQueueByAgent = {}; // agentId -> [{ content }]
let subagentChatQueueDrainTimers = {}; // agentId -> timer id
let subagentChatPendingFilesByAgent = {}; // agentId -> staged files before send
let subagentChatFileStagingPromisesByAgent = {}; // agentId -> Promise[]
let subagentChatApprovalsByAgent = {}; // agentId -> inline approval cards shown in direct chat
let subagentDesktopVoiceTargetAgentId = '';
let agentPackImportPath = 'workspace/oss-agents/marketplace-plan/examples/technical-docs-agent';
let agentPackImportPreview = null;
let agentPackImportBusy = false;

const SUBAGENT_CHAT_TEXT_EXTENSIONS = new Set([
  'txt','md','csv','json','js','ts','jsx','tsx','html','htm','css','scss','less',
  'py','rb','php','java','c','cpp','h','go','rs','sh','bash','yaml','yml',
  'toml','ini','cfg','conf','xml','svg','sql','graphql','vue','svelte','log'
]);
const SUBAGENT_CHAT_IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','gif','bmp','ico','svg']);
const SUBAGENT_CHAT_VIDEO_EXTENSIONS = new Set(['mp4','mov','m4v','webm','avi','mkv','mpeg','mpg','3gp']);

function subagentChatJsArg(value) {
  return JSON.stringify(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getSubagentChatSessionId(agentId) {
  return `subagent_chat_${String(agentId || '').trim()}`;
}

function normalizeSubagentChatApproval(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const id = String(source.id || source.approvalId || fallback.id || fallback.approvalId || '').trim();
  const toolArgs = source.toolArgs && typeof source.toolArgs === 'object' ? source.toolArgs : (fallback.toolArgs || {});
  const sessionId = String(source.sourceSessionId || source.sessionId || fallback.sourceSessionId || fallback.sessionId || '').trim();
  const toolName = String(source.toolName || fallback.toolName || '').trim();
  const approvalKind = String(source.approvalKind || fallback.approvalKind || '').trim();
  const command = String(source.command || toolArgs.command || fallback.command || '').trim();
  const isDevSource = approvalKind === 'dev_source_edit' || toolName === 'request_dev_source_edit';
  const isFinalAction = approvalKind === 'final_action' || toolName === 'request_final_action_approval';
  const isCommand = toolName === 'run_command';
  const title = isDevSource ? 'Dev source edit approval'
    : isFinalAction ? 'Final action approval'
      : isCommand ? 'Command approval'
        : toolName ? `${toolName.replace(/_/g, ' ')} approval` : 'Approval required';
  return {
    ...fallback,
    ...source,
    id,
    sessionId,
    sourceSessionId: sessionId,
    toolName,
    toolArgs,
    approvalKind,
    title,
    action: String(source.action || source.summary || fallback.action || fallback.summary || '').trim(),
    reason: String(source.reason || fallback.reason || '').trim(),
    command,
    summary: String(source.reason || source.summary || source.action || fallback.summary || fallback.action || '').trim(),
    riskScore: Number.isFinite(Number(source.riskScore)) ? Number(source.riskScore) : Number(fallback.riskScore || 0),
    affectedSystems: Array.isArray(source.affectedSystems) ? source.affectedSystems : (Array.isArray(fallback.affectedSystems) ? fallback.affectedSystems : []),
    scopedAction: String(source.scopedAction || fallback.scopedAction || '').trim(),
    scopedTarget: String(source.scopedTarget || fallback.scopedTarget || '').trim(),
    commandBoundary: source.commandBoundary || fallback.commandBoundary || null,
    devSourceEdit: source.devSourceEdit || fallback.devSourceEdit || null,
    finalAction: source.finalAction || fallback.finalAction || null,
    status: String(source.status || fallback.status || 'pending').toLowerCase(),
    agentId: String(source.agentId || fallback.agentId || '').trim(),
  };
}

function subagentApprovalRiskLevel(score) {
  const n = Number(score || 0);
  if (n >= 7) return 'high';
  if (n >= 4) return 'medium';
  return 'low';
}

function renderSubagentInlineApprovalCard(input = {}) {
  const approval = normalizeSubagentChatApproval(input);
  if (!approval.id) return '';
  const status = String(approval.status || 'pending').toLowerCase();
  const pending = status === 'pending';
  const statusLabel = status === 'rejected' ? 'denied' : status;
  const idArg = subagentChatJsArg(approval.id);
  const approveEndpoint = subagentChatJsArg(`/api/approvals/${approval.id}/approve`);
  const denyEndpoint = subagentChatJsArg(`/api/approvals/${approval.id}/deny`);
  const isDevSource = approval.approvalKind === 'dev_source_edit' || approval.toolName === 'request_dev_source_edit';
  const isFinalAction = approval.approvalKind === 'final_action' || approval.toolName === 'request_final_action_approval';
  const technicalText = approval.command || approval.scopedAction || approval.action;
  const sourceFiles = Array.isArray(approval.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
  const sourceDirs = Array.isArray(approval.devSourceEdit?.allowedDirs) ? approval.devSourceEdit.allowedDirs : [];
  const boundary = approval.commandBoundary || null;
  const boundaryScope = String(boundary?.scope || '').trim();
  const boundaryPaths = Array.isArray(boundary?.externalPaths) ? boundary.externalPaths.filter(Boolean) : [];
  return `<div class="chat-approval-card chat-approval-card-${subagentApprovalRiskLevel(approval.riskScore)} chat-approval-card-${escHtml(statusLabel)}" data-approval-id="${escHtml(approval.id)}">
    <div class="chat-approval-head">
      <div>
        <div class="chat-approval-kicker">${pending ? 'Approval needed' : 'Approval result'}</div>
        <div class="chat-approval-title">${escHtml(approval.title)}</div>
      </div>
      <div class="chat-approval-badges">
        <span class="chat-approval-status chat-approval-status-${escHtml(statusLabel)}">${escHtml(statusLabel)}</span>
        ${pending ? `<span class="chat-approval-risk">risk ${escHtml(String(approval.riskScore ?? 0))}</span>` : ''}
      </div>
    </div>
    ${approval.summary ? `<div class="chat-approval-detail">${escHtml(approval.summary)}</div>` : ''}
    ${boundaryScope && boundaryScope !== 'workspace' ? `<div class="chat-approval-scope"><span>Boundary</span>${escHtml(boundaryScope.replace(/_/g, ' '))}${boundary?.reason ? `<br>${escHtml(String(boundary.reason))}` : ''}</div>` : ''}
    ${boundaryPaths.length ? `<div class="chat-approval-scope"><span>External paths</span>${boundaryPaths.slice(0, 8).map((item) => escHtml(String(item))).join('<br>')}</div>` : ''}
    ${sourceFiles.length ? `<div class="chat-approval-scope"><span>Files</span>${sourceFiles.map((file) => escHtml(String(file))).join('<br>')}</div>` : ''}
    ${sourceDirs.length ? `<div class="chat-approval-scope"><span>Workspace docs</span>${sourceDirs.map((dir) => escHtml(String(dir))).join('<br>')}</div>` : ''}
    ${technicalText ? `<details class="chat-approval-technical"><summary>Technical details</summary><pre class="chat-approval-command">${escHtml(technicalText)}</pre></details>` : ''}
    ${pending
      ? `<div class="chat-approval-actions">
          <button class="chat-approval-btn chat-approval-approve" type="button" onclick="resolveSubagentInlineApproval(${idArg}, 'approve', ${approveEndpoint})">Approve</button>
          <button class="chat-approval-btn chat-approval-deny" type="button" onclick="resolveSubagentInlineApproval(${idArg}, 'deny', ${denyEndpoint})">Reject</button>
          ${isDevSource || isFinalAction ? '' : `<button class="chat-approval-link" type="button" onclick="resolveSubagentInlineApproval(${idArg}, 'approve_session', ${approveEndpoint}, 'session')">Trust this session</button>
          <button class="chat-approval-link" type="button" onclick="resolveSubagentInlineApproval(${idArg}, 'approve_always', ${approveEndpoint}, 'always')">Always allow</button>`}
        </div>`
      : `<div class="chat-approval-resolved">This request was ${escHtml(statusLabel)}.</div>`}
  </div>`;
}

function approvalBelongsToSubagentChat(agentId, approvalInput = {}) {
  const approval = normalizeSubagentChatApproval(approvalInput);
  if (!agentId || !approval.id) return false;
  const sid = String(approval.sessionId || approval.sourceSessionId || '').trim();
  return sid === getSubagentChatSessionId(agentId) || String(approval.agentId || '').trim() === String(agentId || '').trim();
}

function upsertSubagentChatApproval(agentId, approvalInput = {}) {
  if (!approvalBelongsToSubagentChat(agentId, approvalInput)) return false;
  const approval = normalizeSubagentChatApproval(approvalInput);
  const list = Array.isArray(subagentChatApprovalsByAgent[agentId]) ? subagentChatApprovalsByAgent[agentId] : [];
  const idx = list.findIndex((item) => String(item?.id || '') === approval.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...approval };
  else list.push(approval);
  subagentChatApprovalsByAgent[agentId] = list.slice(-8);
  if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
  return true;
}

function updateSubagentChatApprovalStatus(id, status, event = {}) {
  const approvalId = String(id || '').trim();
  if (!approvalId) return false;
  let changed = false;
  Object.entries(subagentChatApprovalsByAgent).forEach(([agentId, list]) => {
    const idx = Array.isArray(list) ? list.findIndex((item) => String(item?.id || '') === approvalId) : -1;
    if (idx < 0) return;
    list[idx] = normalizeSubagentChatApproval({ ...list[idx], ...(event.approval || event), id: approvalId, status });
    subagentChatApprovalsByAgent[agentId] = list;
    changed = true;
    if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
  });
  return changed;
}

function renderSubagentChatApprovals(agentId) {
  const list = (Array.isArray(subagentChatApprovalsByAgent[agentId]) ? subagentChatApprovalsByAgent[agentId] : [])
    .filter((item) => item && item.id && String(item.status || 'pending') === 'pending');
  if (!list.length) return '';
  return `<div class="chat-live-approvals">${list.map(renderSubagentInlineApprovalCard).join('')}</div>`;
}

async function resolveSubagentInlineApproval(id, action, endpoint, grantScope = '') {
  if (typeof window.resolveInlineApproval === 'function') {
    await window.resolveInlineApproval(id, action, endpoint, grantScope);
  } else {
    await api(endpoint, { method: 'POST', body: JSON.stringify(grantScope ? { grantScope } : {}) });
  }
  updateSubagentChatApprovalStatus(id, action === 'deny' ? 'rejected' : 'approved', { approvalId: id });
  if (typeof window.loadSessionApprovals === 'function') window.loadSessionApprovals();
}

async function restoreSubagentChatApprovals(agentId) {
  if (!agentId) return;
  try {
    const data = await api('/api/approvals?status=pending');
    (Array.isArray(data?.approvals) ? data.approvals : []).forEach((approval) => upsertSubagentChatApproval(agentId, approval));
  } catch (err) {
    console.warn('[Subagents] could not restore chat approvals:', err);
  }
}

function getSubagentPendingFiles(agentId) {
  if (!subagentChatPendingFilesByAgent[agentId]) subagentChatPendingFilesByAgent[agentId] = [];
  return subagentChatPendingFilesByAgent[agentId];
}

function getSubagentStagingPromises(agentId) {
  if (!subagentChatFileStagingPromisesByAgent[agentId]) subagentChatFileStagingPromisesByAgent[agentId] = [];
  return subagentChatFileStagingPromisesByAgent[agentId];
}

function getSubagentFileIcon(ext) {
  const e = String(ext || '').toLowerCase();
  if (SUBAGENT_CHAT_IMAGE_EXTENSIONS.has(e)) return '🖼️';
  if (SUBAGENT_CHAT_VIDEO_EXTENSIONS.has(e)) return '🎥';
  if (['mp3','wav','ogg','flac','m4a'].includes(e)) return '🎵';
  if (e === 'pdf') return '📄';
  if (['zip','rar','7z','tar','gz'].includes(e)) return '📦';
  if (['doc','docx'].includes(e)) return '📃';
  if (['xls','xlsx','csv'].includes(e)) return '📈';
  if (['ppt','pptx'].includes(e)) return '📊';
  if (['js','ts','jsx','tsx','py','rb','java','c','cpp','go','rs'].includes(e)) return '💻';
  if (['json','yaml','yml','toml','xml'].includes(e)) return '⚙️';
  if (['md','txt'].includes(e)) return '📝';
  return '📎';
}

function getSubagentMimeType(ext) {
  const map = {
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint', zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp',
  };
  return map[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

function stageSubagentChatFiles(agentId, fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!agentId || !files.length) return Promise.resolve([]);
  const promises = files.map(file => new Promise(resolve => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (SUBAGENT_CHAT_TEXT_EXTENSIONS.has(ext)) {
      const reader = new FileReader();
      reader.onload = e => resolve({ file, name: file.name, ext, text: e.target.result, dataUrl: null, binary: false });
      reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true });
      reader.readAsText(file);
      return;
    }
    if (SUBAGENT_CHAT_IMAGE_EXTENSIONS.has(ext)) {
      const reader = new FileReader();
      reader.onload = e => resolve({ file, name: file.name, ext, text: null, dataUrl: e.target.result, binary: false, isImage: true });
      reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true, isImage: true });
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);
      let raw = '';
      for (let i = 0; i < bytes.byteLength; i++) raw += String.fromCharCode(bytes[i]);
      resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true, base64: btoa(raw), isVideo: SUBAGENT_CHAT_VIDEO_EXTENSIONS.has(ext) });
    };
    reader.onerror = () => resolve({ file, name: file.name, ext, text: null, dataUrl: null, binary: true });
    reader.readAsArrayBuffer(file);
  }));
  const stagingPromise = Promise.all(promises).then((staged) => {
    getSubagentPendingFiles(agentId).push(...staged);
    renderSubagentChatAttachmentStaging(agentId);
    return staged;
  }).finally(() => {
    subagentChatFileStagingPromisesByAgent[agentId] = getSubagentStagingPromises(agentId).filter((p) => p !== stagingPromise);
  });
  getSubagentStagingPromises(agentId).push(stagingPromise);
  return stagingPromise;
}

async function waitForSubagentChatFileStaging(agentId) {
  while (getSubagentStagingPromises(agentId).length) {
    await Promise.allSettled(getSubagentStagingPromises(agentId).slice());
  }
}

function subagentStagedFilesToAttachmentPreviews(stagedFiles) {
  return (Array.isArray(stagedFiles) ? stagedFiles : []).map((sf) => sf.isImage && sf.dataUrl
    ? { kind: 'image', name: sf.name, ext: sf.ext || '', workspacePath: '', dataUrl: sf.dataUrl }
    : { kind: sf.isVideo ? 'video' : 'file', name: sf.name, ext: sf.ext || '', workspacePath: '', mimeType: sf.binary || sf.isVideo ? getSubagentMimeType(sf.ext) : '', binary: !!sf.binary });
}

function subagentUploadResultsToAttachmentPreviews(uploadResults) {
  return (Array.isArray(uploadResults) ? uploadResults : []).map((r) => r.isImage && r.base64 && r.mimeType
    ? { kind: 'image', name: r.name, ext: r.ext || '', workspacePath: r.workspacePath || '', dataUrl: `data:${r.mimeType};base64,${r.base64}` }
    : { kind: r.isVideo ? 'video' : 'file', name: r.name, ext: r.ext || '', workspacePath: r.workspacePath || '', mimeType: r.mimeType || '', binary: !!r.binary });
}

async function uploadSubagentChatStagedFiles(stagedFiles) {
  if (!Array.isArray(stagedFiles) || !stagedFiles.length) return [];
  if (typeof window.uploadStagedFilesToCanvas === 'function') return window.uploadStagedFilesToCanvas(stagedFiles);
  const results = [];
  for (const sf of stagedFiles) {
    if (sf.text !== null) {
      try {
        const r = await fetch('/api/canvas/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: sf.name, content: sf.text }) });
        const d = await r.json();
        results.push(d.success ? { name: sf.name, ext: sf.ext, workspacePath: d.absPath, relPath: d.relPath } : { name: sf.name, ext: sf.ext, error: d.error });
      } catch (e) { results.push({ name: sf.name, ext: sf.ext, error: e.message }); }
    } else {
      const base64 = sf.isImage && sf.dataUrl ? sf.dataUrl.replace(/^data:[^;]+;base64,/, '') : sf.base64;
      const mimeType = sf.isImage && sf.dataUrl ? (sf.dataUrl.split(';')[0].replace('data:', '') || getSubagentMimeType(sf.ext)) : getSubagentMimeType(sf.ext);
      if (!base64) { results.push({ name: sf.name, ext: sf.ext, binary: true, isImage: !!sf.isImage, isVideo: !!sf.isVideo, mimeType, error: 'Could not read file bytes' }); continue; }
      try {
        const r = await fetch('/api/canvas/upload-binary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: sf.name, base64, mimeType }) });
        const d = await r.json();
        results.push(d.success
          ? { name: sf.name, ext: sf.ext, workspacePath: d.absPath, relPath: d.relPath, binary: !!sf.binary, isImage: !!sf.isImage, isVideo: !!sf.isVideo, base64: sf.isImage ? base64 : undefined, mimeType }
          : { name: sf.name, ext: sf.ext, binary: !!sf.binary, isImage: !!sf.isImage, isVideo: !!sf.isVideo, mimeType, error: d.error });
      } catch (e) { results.push({ name: sf.name, ext: sf.ext, binary: !!sf.binary, isImage: !!sf.isImage, isVideo: !!sf.isVideo, mimeType, error: e.message }); }
    }
  }
  return results;
}

function buildSubagentFileContextNote(uploadResults) {
  if (typeof window.buildFileContextNote === 'function') return window.buildFileContextNote(uploadResults);
  const lines = uploadResults.map((r) => r.workspacePath ? `  - "${r.name}" -> saved to: ${r.workspacePath}` : `  - "${r.name}" - upload failed: ${r.error || 'unknown error'}`);
  return `\n\n[UPLOADED FILES]\n${lines.join('\n')}\nUse the exact workspace paths above to read, edit, place, or process files.`;
}

function stripSubagentUploadNote(text, attachments = []) {
  const raw = String(text || '');
  return (attachments && attachments.length ? raw.replace(/\n\n\[UPLOADED FILES\][\s\S]*$/, '') : raw).trim();
}

function renderSubagentAttachmentPreviews(attachments, agentId, messageId) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  return `<div class="team-chat-attachment-list">${list.map((item, idx) => {
    const name = String(item?.name || 'file');
    if (item?.kind === 'image' && item.dataUrl) {
      return `<button type="button" class="team-chat-attachment-thumb" title="${escHtml(name)}" onclick="openSubagentChatAttachmentPreview(${subagentChatJsArg(agentId)}, ${subagentChatJsArg(messageId)}, ${idx})"><img src="${item.dataUrl}" alt=""></button>`;
    }
    return `<button type="button" class="team-chat-attachment-file" title="${escHtml(name)}" onclick="openSubagentChatAttachmentPreview(${subagentChatJsArg(agentId)}, ${subagentChatJsArg(messageId)}, ${idx})"><span>${getSubagentFileIcon(item?.ext)}</span><strong>${escHtml(name)}</strong><em>${escHtml(String(item?.ext || 'file'))}</em></button>`;
  }).join('')}</div>`;
}

function renderSubagentChatAttachmentStaging(agentId) {
  const staging = document.getElementById('subagent-chat-file-staging');
  if (!staging) return;
  const files = getSubagentPendingFiles(agentId);
  if (!files.length) { staging.style.display = 'none'; staging.innerHTML = ''; return; }
  staging.style.display = 'flex';
  staging.innerHTML = files.map((f, idx) => {
    const preview = f.isImage && f.dataUrl ? `<img src="${f.dataUrl}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="">` : `<span class="pill-icon">${getSubagentFileIcon(f.ext)}</span>`;
    return `<div class="chat-file-pill">${preview}<span class="pill-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span><span class="pill-ext">${escHtml(f.ext || 'file')}</span><button class="pill-remove" onclick="removeSubagentChatFile(${subagentChatJsArg(agentId)}, ${idx})" title="Remove">&times;</button></div>`;
  }).join('');
  refreshSubagentChatComposerState(agentId);
}

function refreshSubagentChatComposerState(agentId) {
  if (activeSubagentId !== agentId || subagentDetailTab !== 'chat') return;
  const busy = isSubagentChatBusy(agentId);
  const input = document.getElementById('subagent-chat-input');
  const hasOutbound = !!(String(input?.value || subagentChatDraft || '').trim() || getSubagentPendingFiles(agentId).length);
  const abortMode = busy && !hasOutbound;
  const btn = document.getElementById('subagent-chat-send-button');
  if (btn) {
    const voiceMode = !busy && !hasOutbound;
    btn.title = abortMode ? 'Stop the active subagent chat turn' : voiceMode ? 'Start voice mode' : busy ? 'Queue this message for the subagent' : 'Send message';
    btn.setAttribute('aria-label', abortMode ? 'Stop' : voiceMode ? 'Start voice mode' : busy ? 'Queue message' : 'Send');
    btn.onclick = () => abortMode ? abortSubagentChat(agentId) : sendSubagentChat(agentId);
    btn.style.background = abortMode ? '#e05c5c' : 'var(--brand)';
    btn.style.boxShadow = abortMode ? '0 10px 24px rgba(224,92,92,0.24)' : '0 10px 24px rgba(76,141,255,0.24)';
    btn.innerHTML = abortMode
      ? '<iconify-icon icon="solar:stop-bold" width="20" height="20"></iconify-icon>'
      : voiceMode
        ? '<iconify-icon icon="solar:microphone-3-bold-duotone" width="20" height="20"></iconify-icon>'
        : '<iconify-icon icon="solar:arrow-up-bold" width="20" height="20"></iconify-icon>';
  }
  const badge = document.getElementById('subagent-chat-queue-badge');
  if (badge) {
    const queuedCount = getSubagentChatQueue(agentId).length;
    badge.style.display = queuedCount ? 'inline-flex' : 'none';
    badge.textContent = `${queuedCount} queued`;
  }
  if (input) {
    input.placeholder = busy
      ? `Queue a message for ${getActiveSubagentName(agentId)}...`
      : `Message ${getActiveSubagentName(agentId)}...`;
  }
}

function resizeSubagentChatInput() {
  const input = document.getElementById('subagent-chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, Math.max(64, input.scrollHeight))}px`;
}

function removeSubagentChatFile(agentId, idx) {
  getSubagentPendingFiles(agentId).splice(Number(idx), 1);
  renderSubagentChatAttachmentStaging(agentId);
}

function openSubagentChatFilePicker() {
  document.getElementById('subagent-chat-file-input')?.click();
}

function onSubagentChatFilesChosen(agentId, input) {
  if (!input?.files?.length) return;
  stageSubagentChatFiles(agentId, input.files);
  input.value = '';
}

function getSubagentClipboardFiles(clipboardData) {
  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file) return;
    const key = `${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  Array.from(clipboardData?.files || []).forEach(addFile);
  Array.from(clipboardData?.items || []).forEach((item) => {
    if (!item || item.kind !== 'file') return;
    try { addFile(item.getAsFile()); } catch {}
  });
  return files;
}

function handleSubagentChatPaste(event, agentId) {
  const files = getSubagentClipboardFiles(event.clipboardData);
  if (!files.length) return;
  const pastedText = event.clipboardData?.getData?.('text/plain') || '';
  if (!pastedText.trim()) event.preventDefault();
  stageSubagentChatFiles(agentId, files);
  showToast(files.length === 1 ? 'Attachment staged' : `${files.length} attachments staged`, 'Press Send when you are ready.', 'success');
}

function bindSubagentChatAttachmentListeners(agentId) {
  const shell = document.getElementById('subagent-chat-tab-shell');
  if (!shell || shell.dataset.attachBound === agentId) return;
  shell.dataset.attachBound = agentId;
  shell.addEventListener('dragover', (event) => {
    event.preventDefault();
    shell.classList.add('team-chat-drag-over');
  });
  shell.addEventListener('dragleave', (event) => {
    if (!shell.contains(event.relatedTarget)) shell.classList.remove('team-chat-drag-over');
  });
  shell.addEventListener('drop', (event) => {
    event.preventDefault();
    shell.classList.remove('team-chat-drag-over');
    const files = event.dataTransfer?.files;
    if (files?.length) stageSubagentChatFiles(agentId, files);
  });
}

async function openSubagentChatAttachmentPreview(agentId, messageId, attachmentIndex) {
  const message = subagentChatHistory.find((entry) => String(entry.id) === String(messageId));
  const attachment = message?.metadata?.attachmentPreviews?.[Number(attachmentIndex)];
  if (!attachment) return;
  await openSubagentPanelAttachmentPreview('subagent-chat-tab-shell', attachment);
}

async function openSubagentPanelAttachmentPreview(containerId, attachment) {
  const host = document.getElementById(containerId);
  if (!host) return;
  closeSubagentPanelAttachmentPreview(containerId);
  const overlay = document.createElement('div');
  overlay.className = 'panel-attachment-preview-overlay';
  overlay.innerHTML = `<button type="button" class="panel-attachment-preview-close" title="Close" onclick="closeSubagentPanelAttachmentPreview(${subagentChatJsArg(containerId)})">&times;</button><div class="panel-attachment-preview-body">Loading...</div>`;
  host.appendChild(overlay);
  const body = overlay.querySelector('.panel-attachment-preview-body');
  const name = String(attachment.name || 'file');
  try {
    if (attachment.kind === 'image' && attachment.dataUrl) {
      body.innerHTML = `<img src="${attachment.dataUrl}" alt="${escHtml(name)}"><div class="panel-attachment-preview-name">${escHtml(name)}</div>`;
      return;
    }
    if (attachment.workspacePath) {
      const res = await fetch(`/api/canvas/file?path=${encodeURIComponent(attachment.workspacePath)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.isImage && data.base64 && data.mimeType) {
        body.innerHTML = `<img src="data:${data.mimeType};base64,${data.base64}" alt="${escHtml(name)}"><div class="panel-attachment-preview-name">${escHtml(name)}</div>`;
      } else if (data.content !== undefined) {
        body.innerHTML = `<div class="panel-attachment-preview-name">${escHtml(name)}</div><pre>${escHtml(String(data.content || ''))}</pre>`;
      } else {
        body.innerHTML = `<div class="panel-attachment-preview-file"><div>${getSubagentFileIcon(attachment.ext)}</div><strong>${escHtml(name)}</strong><span>${escHtml(attachment.workspacePath)}</span><button type="button" onclick="canvasPresentFile(${subagentChatJsArg(attachment.workspacePath)}, ${subagentChatJsArg(name)})">Open in Canvas</button></div>`;
      }
    } else {
      body.innerHTML = `<div class="panel-attachment-preview-file"><div>${getSubagentFileIcon(attachment.ext)}</div><strong>${escHtml(name)}</strong><span>Upload completes when the message sends.</span></div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="panel-attachment-preview-file"><strong>Preview unavailable</strong><span>${escHtml(String(err?.message || err))}</span></div>`;
  }
}

function closeSubagentPanelAttachmentPreview(containerId = 'subagent-chat-tab-shell') {
  document.querySelectorAll(`#${CSS.escape(containerId)} .panel-attachment-preview-overlay`).forEach((el) => el.remove());
}

function getSubagentStreamingState(agentId) {
  if (!agentId) return null;
  return subagentStreamingStateByAgent[agentId] || null;
}

function isSubagentChatBusy(agentId) {
  return !!(getSubagentStreamingState(agentId)?.completed === false);
}

function getSubagentChatQueue(agentId, create = false) {
  if (!agentId) return [];
  if (!subagentChatQueueByAgent[agentId] && create) subagentChatQueueByAgent[agentId] = [];
  return subagentChatQueueByAgent[agentId] || [];
}

function queueSubagentChatMessage(agentId, content, files = []) {
  const text = String(content || '').trim();
  const stagedFiles = Array.isArray(files) ? files.slice() : [];
  if (!text && !stagedFiles.length) return false;
  const queue = getSubagentChatQueue(agentId, true);
  if (queue.length >= MAX_SUBAGENT_CHAT_QUEUE) {
    showToast('Queue full', `Wait for ${getActiveSubagentName(agentId)} to catch up before adding more.`, 'warning');
    return false;
  }
  queue.push({ content: text, files: stagedFiles });
  showToast('Queued', `${getActiveSubagentName(agentId)} will receive this next.`, 'info');
  return true;
}

function scheduleNextSubagentQueuedMessage(agentId) {
  if (!agentId || isSubagentChatBusy(agentId) || subagentChatQueueDrainTimers[agentId]) return;
  const queue = getSubagentChatQueue(agentId);
  if (queue.length === 0) return;
  subagentChatQueueDrainTimers[agentId] = setTimeout(() => {
    delete subagentChatQueueDrainTimers[agentId];
    if (isSubagentChatBusy(agentId)) return;
    const next = getSubagentChatQueue(agentId).shift();
    if (!next?.content && !next?.files?.length) return;
    sendSubagentChat(agentId, next);
  }, 120);
  if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
}

function syncActiveSubagentStreamingState() {
  subagentStreamingState = activeSubagentId ? getSubagentStreamingState(activeSubagentId) : null;
  _subagentChatSending = !!(subagentStreamingState && subagentStreamingState.completed !== true);
  return subagentStreamingState;
}

function setSubagentStreamingState(agentId, state) {
  if (!agentId) return null;
  if (state) {
    subagentStreamingStateByAgent[agentId] = state;
  } else {
    delete subagentStreamingStateByAgent[agentId];
  }
  if (activeSubagentId === agentId) syncActiveSubagentStreamingState();
  return state;
}

// ── Per-agent detail state (reset on agent switch) ─────────────────────────
let subagentSystemPrompt = '';
let subagentContextRefs = [];
let subagentSkillsCache = [];
let subagentMemoryNotes = '';
let subagentHbConfig = { enabled: false, intervalMinutes: 30 };
let subagentHbMd = '';
let _subagentCtxRefEditId = null;   // ref id currently in edit modal

// ── Avatar colors / icons ──────────────────────────────────────────────────
const AGENT_COLORS = ['#4c8dff','#31b884','#d6a64f','#e05c5c','#a78bfa','#38bdf8','#fb923c','#4ade80'];
const AGENT_EMOJIS = ['🤖','🦾','⚡','🧬','🛸','👾','🔬','🧠'];

function _hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function agentColor(id) { return AGENT_COLORS[_hashStr(id) % AGENT_COLORS.length]; }
function getActiveSubagentName(agentId) {
  const agent = subagentsData.find(a => a.id === agentId);
  return agent?.name || agentId || 'Agent';
}
function agentEmoji(agent) {
  if (agent.emoji) return agent.emoji;
  return AGENT_EMOJIS[_hashStr(agent.id || '') % AGENT_EMOJIS.length];
}

// ── Robot SVG Avatar ──────────────────────────────────────────────────────────
function drawAgentSVG(agent, isActive, scale = 1) {
  const color = agentColor(agent.id);
  const h = _hashStr(agent.id);
  const eyeStyle = h % 3; // 0=round, 1=square, 2=visor
  const antenna = !!(h % 2);
  const glowColor = isActive ? 'rgba(76,141,255,0.55)' : 'none';
  const W = 80, H = 90;

  const eyesHtml = eyeStyle === 1
    ? `<rect x="20" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="48" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="23" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>
       <rect x="51" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>`
    : eyeStyle === 2
    ? `<rect x="18" y="32" width="44" height="14" rx="4" fill="rgba(0,0,0,0.4)"/>
       <rect x="22" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>
       <rect x="44" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>`
    : `<circle cx="28" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="52" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="28" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="52" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="29" cy="37" r="1.5" fill="#fff"/>
       <circle cx="53" cy="37" r="1.5" fill="#fff"/>`;

  const mouthY = 52;
  const mouthHtml = h % 4 === 0
    ? `<path d="M26 ${mouthY} Q40 ${mouthY+8} 54 ${mouthY}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`
    : h % 4 === 1
    ? `<rect x="26" y="${mouthY}" width="28" height="5" rx="2" fill="rgba(0,0,0,0.3)"/>
       <rect x="28" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="34" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="40" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="46" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>`
    : `<line x1="26" y1="${mouthY+2}" x2="54" y2="${mouthY+2}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="${W*scale}" height="${H*scale}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;filter:${glowColor !== 'none' ? `drop-shadow(0 0 9px ${glowColor})` : 'none'};transition:filter 0.2s">
    <!-- Shadow -->
    <ellipse cx="40" cy="${H-4}" rx="28" ry="4" fill="rgba(0,0,0,0.12)"/>
    <!-- Body -->
    <rect x="20" y="62" width="40" height="22" rx="6" fill="${color}" opacity="0.85"/>
    <!-- Arms -->
    <rect x="8" y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <rect x="62" y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <!-- Legs -->
    <rect x="24" y="80" width="11" height="8" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="45" y="80" width="11" height="8" rx="3" fill="${color}" opacity="0.7"/>
    <!-- Head -->
    <rect x="14" y="20" width="52" height="42" rx="10" fill="${color}"/>
    <rect x="16" y="22" width="48" height="38" rx="9" fill="${color}" opacity="0.7"/>
    <!-- Eyes -->
    ${eyesHtml}
    <!-- Mouth -->
    ${mouthHtml}
    <!-- Chest light -->
    <circle cx="40" cy="71" r="4" fill="rgba(255,255,255,0.25)"/>
    <circle cx="40" cy="71" r="2.5" fill="${isActive ? '#fff' : 'rgba(255,255,255,0.5)'}"/>
    <!-- Antenna -->
    ${antenna ? `<line x1="40" y1="20" x2="40" y2="10" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="40" cy="8" r="3.5" fill="${color}"/>
    <circle cx="40" cy="8" r="2" fill="#fff" opacity="0.8"/>` : ''}
  </svg>`;
}

// ── Fetch & Render ────────────────────────────────────────────────────────────
async function refreshSubagents() {
  console.log('[SubagentsPage] refreshSubagents called');
  try {
    const data = await api('/api/agents', { timeoutMs: 8000 });
    console.log('[SubagentsPage] agents loaded:', data.agents?.length);
    // Show all non-default, non-synthetic agents — including team members (with badge)
    subagentsData = (data.agents || []).filter(a => !a.default && !a.isSynthetic);
    window.subagentsData = subagentsData;
    renderSubagentsCanvas();
  } catch (err) {
    console.error('[SubagentsPage] refreshSubagents error:', err);
    const canvas = document.getElementById('subagents-canvas');
    if (canvas) canvas.innerHTML = `<div style="color:var(--muted);padding:24px;font-size:13px">Error loading agents: ${escHtml(err.message)}</div>`;
  }
}

function renderAgentPackImportPanel() {
  const preview = agentPackImportPreview?.preview || agentPackImportPreview;
  const scanner = preview?.scanner;
  const agent = preview?.agent;
  const disabled = agentPackImportBusy ? 'disabled' : '';
  const statusColor = scanner?.status === 'failed' ? '#991b1b' : scanner?.status === 'warning' ? '#92400e' : '#166534';
  const statusBg = scanner?.status === 'failed' ? '#fee2e2' : scanner?.status === 'warning' ? '#fef3c7' : '#dcfce7';
  return `
    <div style="width:100%;border:1px solid var(--line);background:linear-gradient(135deg,var(--panel),var(--panel-2));border-radius:16px;padding:14px;margin-bottom:14px;box-sizing:border-box">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="min-width:220px;flex:1">
          <div style="font-size:12px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Agent Profile Pack Import</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px;line-height:1.45">Preview and install local marketplace profile packs as real Prometheus subagents.</div>
        </div>
        ${preview ? `<span style="font-size:10px;font-weight:800;border:1px solid ${statusColor};background:${statusBg};color:${statusColor};border-radius:999px;padding:4px 8px">${escHtml(scanner?.status || 'previewed')}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap">
        <input id="agent-pack-import-path" value="${escHtml(agentPackImportPath)}" placeholder="workspace/path/to/agent-profile-pack" style="flex:1;min-width:260px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font-size:12px;background:var(--panel);color:var(--text)" />
        <button type="button" ${disabled} onclick="previewAgentProfilePackImport()" style="border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer">Preview</button>
        <button type="button" ${disabled} onclick="installAgentProfilePackImport()" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer">Install</button>
      </div>
      ${preview ? `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:11px;color:var(--muted)">
        <div><strong style="color:var(--text)">${escHtml(agent?.name || preview?.manifest?.name || 'Profile Pack')}</strong><br>${escHtml(preview?.manifest?.id || '')}</div>
        <div><strong style="color:var(--text)">Agent ID</strong><br><code>${escHtml(preview?.installPlan?.agentId || agent?.id || '')}</code></div>
        <div><strong style="color:var(--text)">Skills</strong><br>${escHtml((preview?.skills || []).map(s => s.slug).join(', ') || 'none')}</div>
        <div><strong style="color:var(--text)">Issues</strong><br>${escHtml(String(scanner?.issues?.length || 0))} finding${(scanner?.issues?.length || 0) === 1 ? '' : 's'}</div>
      </div>` : ''}
      ${scanner?.issues?.length ? `<details style="margin-top:10px;font-size:11px;color:var(--muted)"><summary style="cursor:pointer;font-weight:800;color:var(--text)">Scanner findings</summary><ul style="margin:8px 0 0 18px;padding:0">${scanner.issues.map(issue => `<li><strong>${escHtml(issue.severity)}</strong> ${escHtml(issue.code)}: ${escHtml(issue.message)}${issue.file ? ` <code>${escHtml(issue.file)}</code>` : ''}</li>`).join('')}</ul></details>` : ''}
    </div>`;
}

function renderSubagentsCanvas() {
  const canvas = document.getElementById('subagents-canvas');
  if (!canvas) return;

  const countEl = document.getElementById('subagents-count');
  if (countEl) countEl.textContent = `${subagentsData.length} agent${subagentsData.length !== 1 ? 's' : ''}`;

  const importPanel = renderAgentPackImportPanel();

  if (subagentsData.length === 0) {
    canvas.innerHTML = `${importPanel}
      <div style="text-align:center;color:var(--muted);padding:80px 24px">
        <div style="font-size:52px;margin-bottom:16px">🤖</div>
        <div style="font-size:18px;font-weight:800;margin-bottom:8px">No subagents configured</div>
        <div style="font-size:13px;line-height:1.6;max-width:380px;margin:0 auto">Create agents in <strong>Settings → Agents</strong> or import an Agent Profile Pack.</div>
      </div>`;
    return;
  }

  canvas.innerHTML = importPanel + subagentsData.map(agent => {
    const isActive = agent.id === activeSubagentId;
    const lastRun = agent.lastRun?.finishedAt ? timeAgo(agent.lastRun.finishedAt) : null;
    const modelLabel = agent.effectiveModel ? agent.effectiveModel.split('/').pop() : null;
    const teamBadge = agent.isTeamMember ? `<div style="position:absolute;top:-4px;left:-4px;font-size:9px;background:#eaf2ff;color:#0d4faf;border:1px solid #bcd4f8;border-radius:999px;padding:1px 5px;font-weight:700;white-space:nowrap">team</div>` : '';
    const schedBadge = agent.cronSchedule ? `<div style="position:absolute;top:-4px;right:-6px;font-size:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:1px 5px;font-weight:700">⏰</div>` : '';
    const marketplaceBadge = agent.marketplaceProfile?.packId ? `<div style="position:absolute;bottom:-4px;right:-6px;font-size:10px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;border-radius:999px;padding:1px 5px;font-weight:800">pack</div>` : '';
    return `
      <div class="subagent-card" data-agent-id="${agent.id}"
           onclick="openSubagentDetail('${escHtml(agent.id)}')"
           style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;padding:16px 12px;border-radius:16px;transition:all 0.2s;position:relative;${isActive ? 'background:var(--panel-2);box-shadow:0 0 0 2px var(--brand);transform:scale(1.04)' : 'background:var(--panel);border:1px solid var(--line)'}">
        <div style="position:relative">
          ${drawAgentSVG(agent, isActive, 0.9)}
          ${teamBadge}
          ${schedBadge}
          ${marketplaceBadge}
        </div>
        <div style="text-align:center;max-width:90px">
          <div style="font-size:11px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.name || agent.id)}</div>
          ${modelLabel ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(modelLabel)}</div>` : ''}
          ${lastRun ? `<div style="font-size:9px;color:var(--muted);margin-top:1px">Last: ${lastRun}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
async function openSubagentDetail(agentId) {
  activeSubagentId = agentId;
  subagentDetailTab = getSubagentStreamingState(agentId) ? 'chat' : 'overview';
  subagentRuns = [];
  activeSubagentRunId = '';
  subagentRunDetails = {};
  subagentChatHistory = [];
  syncActiveSubagentStreamingState();
  subagentSystemPrompt = '';
  subagentContextRefs = [];
  subagentMemoryNotes = '';
  subagentHbConfig = { enabled: false, intervalMinutes: 30 };
  subagentHbMd = '';

  const board = document.getElementById('subagent-board');
  const canvasWrap = document.getElementById('subagents-canvas-wrap');

  canvasWrap.style.transition = 'width 0.35s cubic-bezier(0.4,0,0.2,1)';
  canvasWrap.style.width = '38%';
  board.style.display = 'flex';
  board.style.width = '62%';
  board.style.opacity = '0';
  setTimeout(() => { board.style.opacity = '1'; }, 60);

  // Dim inactive cards
  document.querySelectorAll('.subagent-card').forEach(el => {
    const isActive = el.dataset.agentId === agentId;
    el.style.transition = 'opacity 0.3s, transform 0.35s';
    el.style.opacity = isActive ? '1' : '0.25';
    el.style.pointerEvents = isActive ? '' : 'none';
  });

  renderSubagentsCanvas();
  await loadSubagentBoardData(agentId);
  renderSubagentBoard(agentId);
  if (subagentDetailTab === 'chat') restoreSubagentChatScroll({ hadChat: false }, { forceBottom: true });
  startSubagentPolling(agentId);
}

function closeSubagentDetail() {
  stopSubagentPolling();
  activeSubagentId = null;
  syncActiveSubagentStreamingState();

  const board = document.getElementById('subagent-board');
  const canvasWrap = document.getElementById('subagents-canvas-wrap');

  board.style.opacity = '0';
  setTimeout(() => {
    board.style.display = 'none';
    board.style.width = '0';
  }, 300);

  canvasWrap.style.transition = 'width 0.35s cubic-bezier(0.4,0,0.2,1)';
  canvasWrap.style.width = '100%';

  document.querySelectorAll('.subagent-card').forEach(el => {
    el.style.opacity = '1';
    el.style.pointerEvents = '';
  });

  renderSubagentsCanvas();
}

async function loadSubagentBoardData(agentId) {
  try {
    const [runsData, chatData, ctxData, skillsData] = await Promise.all([
      api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`).catch(() => ({ runs: [] })),
      api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`),
      api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`).catch(() => ({ refs: [] })),
      api('/api/skills').catch(() => ({ skills: [] })),
    ]);
    subagentRuns = runsData.runs || [];
    subagentChatHistory = preserveSubagentProcessMetadata(normalizeSubagentChatMessages(chatData.messages || []));
    subagentContextRefs = ctxData.refs || [];
    subagentSkillsCache = Array.isArray(skillsData.skills) ? skillsData.skills : [];
  } catch (err) {
    console.error('[Subagents] loadData:', err);
  }
}

function normalizeSubagentChatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((m, idx) => ({
    id: m.id || `chat_${m.ts || Date.now()}_${idx}`,
    agentId: m.agentId || m.metadata?.agentId || activeSubagentId || undefined,
    role: m.role === 'user' || m.role === 'system' ? m.role : 'agent',
    content: String(m.content || ''),
    ts: Number(m.ts || Date.now()),
    steps: Number(m.steps || m.metadata?.stepCount || 0) || undefined,
    duration: Number(m.duration || (m.metadata?.durationMs ? Math.round(Number(m.metadata.durationMs) / 1000) : 0)) || undefined,
    metadata: m.metadata || {},
  }));
}

function newSubagentProcessEntry(type, content, extra = undefined) {
  return {
    ts: new Date().toLocaleTimeString(),
    type: String(type || 'info'),
    content: String(content || ''),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

function pushSubagentProgressLine(line, state = subagentStreamingState) {
  if (!state) return;
  const text = String(line || '').trim();
  if (!text) return;
  const lines = Array.isArray(state.progressLines) ? state.progressLines : [];
  if (lines[lines.length - 1] === text) return;
  lines.push(text);
  if (lines.length > 8) lines.splice(0, lines.length - 8);
  state.progressLines = lines;
}

function addSubagentProcessEntry(type, content, extra = undefined, state = subagentStreamingState) {
  if (!state) return;
  if (!Array.isArray(state.processEntries)) state.processEntries = [];
  state.processEntries.push(newSubagentProcessEntry(type, content, extra));
  appendSubagentLiveTrace(state, type, content);
}

function appendSubagentLiveTrace(state, type, text, { append = false } = {}) {
  if (!state) return;
  const content = String(text || '');
  if (!content) return;
  const normalizedType = String(type || 'info').toLowerCase();
  if (normalizedType === 'final' || normalizedType === 'user') return;
  if (!Array.isArray(state.liveTraceEntries)) state.liveTraceEntries = [];
  const last = state.liveTraceEntries[state.liveTraceEntries.length - 1];
  if (append && last && String(last.type || '').toLowerCase() === normalizedType) {
    last.text = `${last.text || ''}${content}`;
    return;
  }
  const trimmed = content.trim();
  if (!trimmed) return;
  if (last && String(last.type || '').toLowerCase() === normalizedType && String(last.text || '').trim() === trimmed) return;
  state.liveTraceEntries.push({
    type: normalizedType,
    text: trimmed,
    ts: new Date().toLocaleTimeString(),
  });
}

function moveSubagentVisibleAnswerIntoWorkflowTrace(state) {
  if (!state) return;
  const text = String(state.content || '').trim();
  if (!text) return;
  appendSubagentLiveTrace(state, state.toolActivityStarted ? 'think' : 'preamble', text);
  state.content = '';
  state.finalResponseStarted = false;
}

function normalizeSubagentTraceProseText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 5) {
    const shortLines = lines.filter((line) => line.split(/\s+/).filter(Boolean).length <= 2).length;
    if (shortLines / lines.length >= 0.75) return raw.replace(/\s+/g, ' ').trim();
  }
  return raw;
}

function isSubagentPreparedTraceEntry(entry) {
  const type = String(entry?.type || '').toLowerCase();
  const text = String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim();
  return type === 'tool' && /^Prepared\b/i.test(text);
}

function isSubagentStartupTraceText(text) {
  return /^(request received\. starting chat turn|preparing chat context|preparing prometheus runtime|building model context|connecting\.\.\.)$/i
    .test(String(text || '').replace(/\s+/g, ' ').trim());
}

function normalizeSubagentTraceEntry(entry, finalText = '') {
  if (!entry || typeof entry !== 'object') return null;
  let type = String(entry.type || entry.kind || 'info').toLowerCase();
  const text = String(entry.text || entry.content || entry.message || '').trim();
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!text || isSubagentStartupTraceText(text)) return null;
  if (type === 'user' || type === 'final' || /^user\s*:/i.test(text)) return null;
  if (finalText && normalizedText === finalText) return null;
  if (type === 'skill') type = 'tool';
  if (type === 'process') type = /^thinking(?:\.\.\.)?$/i.test(normalizedText) ? 'think' : 'info';
  return {
    ...entry,
    type,
    text,
  };
}

function subagentWorkflowTraceEntriesForMessage(message) {
  const finalText = String(message?.content || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    const normalized = normalizeSubagentTraceEntry(entry, finalText);
    if (!normalized || isSubagentPreparedTraceEntry(normalized)) return;
    const key = `${normalized.type}|${String(normalized.text || '').replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };
  (Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : []).forEach(add);
  (Array.isArray(message?.metadata?.liveTraceEntries) ? message.metadata.liveTraceEntries : []).forEach(add);
  (Array.isArray(message?.processEntries) ? message.processEntries : []).forEach(add);
  (Array.isArray(message?.metadata?.processEntries) ? message.metadata.processEntries : []).forEach(add);
  return out;
}

function visibleSubagentTraceEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeSubagentTraceEntry(entry))
    .filter((entry) => entry && !isSubagentPreparedTraceEntry(entry) && String(entry.text || '').trim());
}

function renderSubagentTraceEntry(entry) {
  const type = String(entry?.type || 'info').toLowerCase();
  const text = String(entry?.text || entry?.content || '').trim();
  if (type === 'preamble' || type === 'think' || type === 'assistant') {
    return `<div class="live-turn-prose live-turn-${escHtml(type)}"><div class="live-turn-md">${typeof marked !== 'undefined' ? marked.parse(normalizeSubagentTraceProseText(text)) : escHtml(normalizeSubagentTraceProseText(text))}</div></div>`;
  }
  const label = type === 'vision' ? 'Vision' : type === 'result' ? 'Tool result' : type === 'error' ? 'Tool error' : 'Tool';
  return `<div class="live-turn-segment live-turn-${escHtml(type)}"><span>${escHtml(label)}</span><div class="live-turn-text">${escHtml(text)}</div></div>`;
}

function renderSubagentTraceList(entries) {
  const list = visibleSubagentTraceEntries(entries);
  if (!list.length) return '';
  return `<div class="live-turn-trace">${list.map(renderSubagentTraceEntry).join('')}</div>`;
}

function subagentTraceGroups(entries) {
  const list = visibleSubagentTraceEntries(entries);
  const groups = [];
  let activeToolGroup = null;
  list.forEach((entry) => {
    const type = String(entry?.type || '').toLowerCase();
    if (type === 'preamble' || type === 'think' || type === 'assistant') {
      activeToolGroup = null;
      groups.push({ kind: 'thought', entries: [entry] });
      return;
    }
    if (!activeToolGroup) {
      activeToolGroup = { kind: 'tools', entries: [] };
      groups.push(activeToolGroup);
    }
    activeToolGroup.entries.push(entry);
  });
  return groups;
}

function subagentTraceHasToolGroup(entries) {
  return subagentTraceGroups(entries).some((group) => group.kind === 'tools' && group.entries.length > 0);
}

function subagentTraceToolLabel(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*Step\s+\d+:\s*/i, '')
    .replace(/^Running\s+/i, '')
    .replace(/^Preparing\s+/i, '')
    .replace(/^Prepared\s+/i, '')
    .replace(/\s*(?:->|=>|→).*/, '')
    .replace(/:\s+(?!\{).*/, '')
    .replace(/\s+(?:complete|failed)$/i, '')
    .replace(/\s+\{.*$/, '')
    .trim();
}

function subagentTraceToolSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const toolish = list.filter((entry) => ['tool', 'result', 'error', 'vision', 'info'].includes(String(entry?.type || '').toLowerCase()));
  const labels = [...new Set(toolish.map((entry) => subagentTraceToolLabel(entry.text)).filter(Boolean))];
  const errors = [...new Set(list
    .filter((entry) => String(entry?.type || '').toLowerCase() === 'error')
    .map((entry) => subagentTraceToolLabel(entry.text))
    .filter(Boolean))].length;
  const logicalCount = Math.max(labels.length, errors || 0, toolish.length ? 1 : 0);
  if (errors) return `${errors} tool${errors === 1 ? '' : 's'} failed`;
  if (labels.length === 1) return `${labels[0]}${logicalCount > 1 ? ` x${logicalCount}` : ''}`;
  const count = logicalCount || list.length;
  return `Ran ${count} tool${count === 1 ? '' : 's'}`;
}

function renderSubagentGroupedTrace(entries, { streaming = false } = {}) {
  const groups = subagentTraceGroups(entries);
  if (!groups.length) return '';
  const lastToolIndex = groups.map((group, index) => group.kind === 'tools' ? index : -1).filter((index) => index >= 0).pop();
  return `<div class="live-turn-timeline">${groups.map((group, index) => {
    if (group.kind === 'thought') {
      return `<div class="live-turn-thought">${group.entries.map(renderSubagentTraceEntry).join('')}</div>`;
    }
    const open = streaming && index === lastToolIndex;
    const summary = subagentTraceToolSummary(group.entries);
    const eventCount = visibleSubagentTraceEntries(group.entries).length;
    return `<details class="live-turn-tool-group"${open ? ' open data-live-trace-current="1"' : ''}>
      <summary class="live-turn-tool-summary">
        <span class="live-turn-tool-icon" aria-hidden="true">›</span>
        <strong>${escHtml(summary)}</strong>
        <em>${eventCount} event${eventCount === 1 ? '' : 's'}</em>
      </summary>
      <div class="live-turn-tool-body">${renderSubagentTraceList(group.entries)}</div>
    </details>`;
  }).join('')}</div>`;
}

function subagentTraceDrawerId(message) {
  return `sa_trace_${String(message?.id || message?.ts || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function renderSubagentWorkTimer(message, durationSec) {
  if (!durationSec) return '';
  const entries = subagentWorkflowTraceEntriesForMessage(message);
  const label = `Worked for ${formatSubagentElapsedSeconds(durationSec)}`;
  if (!subagentTraceHasToolGroup(entries)) return `<div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:6px">${escHtml(label)}</div>`;
  const id = subagentTraceDrawerId(message);
  return `<button type="button" class="assistant-work-timer assistant-work-timer--expandable" aria-expanded="false" aria-controls="${escHtml(id)}" onclick="toggleSubagentTraceDrawer('${escHtml(id)}')">
    <span>${escHtml(label)}</span>
    <svg class="assistant-work-timer-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`;
}

function renderSubagentTraceDrawer(message) {
  const entries = subagentWorkflowTraceEntriesForMessage(message);
  if (!subagentTraceHasToolGroup(entries)) return '';
  return `<div id="${escHtml(subagentTraceDrawerId(message))}" class="assistant-trace-drawer">${renderSubagentGroupedTrace(entries, { streaming: false })}</div>`;
}


function formatSubagentElapsedSeconds(seconds) {
  const total = Math.max(1, Math.round(Number(seconds || 0)));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatSubagentProcessLines(entries) {
  if (!entries || entries.length === 0) return '<div style="color:var(--muted)">No process details.</div>';
  const TYPE_COLORS = {
    user: 'var(--text)',
    think: '#388bfd',
    tool: '#e3b341',
    result: '#bc8cff',
    error: '#e05c5c',
    final: '#56d364',
    warn: '#d6a64f',
    info: '#79c0ff',
  };
  return entries.map((entry) => {
    const type = String(entry?.type || 'info');
    const color = TYPE_COLORS[type] || 'var(--muted)';
    const ts = escHtml(String(entry?.ts || ''));
    const content = escHtml(String(entry?.content || ''));
    return `<div style="margin-bottom:4px"><span style="color:var(--muted)">[${ts}]</span> <span style="color:${color};font-weight:700">${escHtml(type.toUpperCase())}</span> ${content}</div>`;
  }).join('');
}

function renderSubagentProcessPill(entries, prefix = 'sa_proc') {
  if (!entries || entries.length === 0) return '';
  const id = `${prefix}_${Math.random().toString(36).slice(2)}`;
  const count = Array.isArray(entries) ? entries.length : 0;
  return `
    <div style="margin-top:8px">
      <button class="process-pill-btn" onclick="toggleSubagentProcess('${id}')">Process${count ? ` (${count})` : ''}</button>
      <div id="${id}" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.6">
        ${formatSubagentProcessLines(entries)}
      </div>
    </div>
  `;
}

function mergeStreamingStateIntoMessage(message) {
  if (!message) return message;
  const messageAgentId = message.agentId || message.metadata?.agentId || activeSubagentId || null;
  const streamState = getSubagentStreamingState(messageAgentId) || subagentStreamingState;
  if (!streamState || message.role !== 'agent' || messageAgentId !== streamState.agentId) return message;
  const metadata = {
    ...(message.metadata || {}),
    processEntries: Array.isArray(streamState.processEntries) ? [...streamState.processEntries] : [],
    liveTraceEntries: Array.isArray(streamState.liveTraceEntries) ? [...streamState.liveTraceEntries] : [],
    thinking: String(streamState.thinking || '').trim(),
  };
  return { ...message, agentId: messageAgentId, metadata };
}

function hasSubagentProcessMetadata(message) {
  const metadata = message?.metadata || {};
  return (Array.isArray(metadata.processEntries) && metadata.processEntries.length > 0)
    || (Array.isArray(metadata.liveTraceEntries) && metadata.liveTraceEntries.length > 0)
    || String(metadata.thinking || '').trim();
}

function sameSubagentChatTurn(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const aContent = String(a.content || '').trim();
  const bContent = String(b.content || '').trim();
  if (!aContent || aContent !== bContent) return false;
  if (a.role !== b.role) return false;
  const delta = Math.abs(Number(a.ts || 0) - Number(b.ts || 0));
  return !Number.isFinite(delta) || delta < 5 * 60 * 1000;
}

function isLocalSubagentChatMessage(message) {
  const id = String(message?.id || '');
  const metadata = message?.metadata || {};
  return !!(metadata.pending || metadata.localStreamingFallback || id.startsWith('pending_') || id.startsWith('stream_'));
}

function mergeSubagentChatMessageProcessMetadata(preferred, fallback) {
  if (!preferred) return fallback;
  if (!fallback) return preferred;
  if (hasSubagentProcessMetadata(preferred) || !hasSubagentProcessMetadata(fallback)) return preferred;
  return {
    ...preferred,
    metadata: {
      ...(preferred.metadata || {}),
      processEntries: Array.isArray(fallback.metadata?.processEntries) ? [...fallback.metadata.processEntries] : [],
      liveTraceEntries: Array.isArray(fallback.metadata?.liveTraceEntries) ? [...fallback.metadata.liveTraceEntries] : [],
      thinking: String(fallback.metadata?.thinking || '').trim(),
    },
  };
}

function dedupeSubagentChatMessages(messages) {
  const out = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const existingIndex = out.findIndex((entry) => sameSubagentChatTurn(entry, message));
    if (existingIndex < 0) {
      out.push(message);
      continue;
    }
    const existing = out[existingIndex];
    const preferIncoming = isLocalSubagentChatMessage(existing) && !isLocalSubagentChatMessage(message);
    const preferred = preferIncoming ? message : existing;
    const fallback = preferIncoming ? existing : message;
    out[existingIndex] = mergeSubagentChatMessageProcessMetadata(preferred, fallback);
  }
  return out;
}

function preserveSubagentProcessMetadata(freshMessages, localMessages = subagentChatHistory) {
  const localWithProcess = (Array.isArray(localMessages) ? localMessages : []).filter(hasSubagentProcessMetadata);
  const mapped = (Array.isArray(freshMessages) ? freshMessages : []).map((fresh) => {
    if (hasSubagentProcessMetadata(fresh)) return fresh;
    const local = localWithProcess.find((m) => sameSubagentChatTurn(m, fresh));
    return local ? mergeSubagentChatMessageProcessMetadata(fresh, local) : fresh;
  });
  return dedupeSubagentChatMessages(mapped);
}

function commitSubagentStreamingReply(agentId, streamState, content, startTs, extraMetadata = {}) {
  if (!streamState || getSubagentStreamingState(agentId) !== streamState) return false;
  const finalContent = String(content || streamState.finalReply || streamState.content || '').trim();
  if (!finalContent) return false;
  const [message] = normalizeSubagentChatMessages([{
    id: `stream_${Date.now()}`,
    agentId,
    role: 'agent',
    content: finalContent,
    ts: Date.now(),
    metadata: {
      source: 'subagent_chat',
      durationMs: Date.now() - startTs,
      localStreamingFallback: true,
      ...extraMetadata,
    },
  }]);
  if (!message) return false;
  subagentChatHistory = subagentChatHistory.filter(m => !(
    ((m.metadata?.pending || m.metadata?.localStreamingFallback) && m.role === message.role && m.content === message.content)
  ));
  if (!subagentChatHistory.some((m) => m.id === message.id)) {
    const durationSec = Math.round((Date.now() - startTs) / 1000);
    subagentChatHistory.push(mergeStreamingStateIntoMessage({ ...message, duration: durationSec }));
    subagentChatHistory = dedupeSubagentChatMessages(subagentChatHistory);
  }
  if (subagentDesktopVoiceTargetAgentId === agentId && finalContent) {
    speakSubagentVoiceReply(finalContent);
    subagentDesktopVoiceTargetAgentId = '';
  }
  setSubagentStreamingState(agentId, null);
  if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
  return true;
}

async function reconcileSubagentChatFromServer(agentId, streamState, sinceTs = 0) {
  try {
    const chat = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
    const freshChat = normalizeSubagentChatMessages(chat.messages || []);
    const hasNewAgentReply = freshChat.some((m) =>
      m.role === 'agent'
      && Number(m.ts || 0) >= Number(sinceTs || 0)
      && String(m.content || '').trim()
      && !/^\(No response received\.\)$/i.test(String(m.content || '').trim())
    );
    if (!hasNewAgentReply) return false;
    subagentChatHistory = preserveSubagentProcessMetadata(freshChat);
    if (streamState && getSubagentStreamingState(agentId) === streamState) {
      setSubagentStreamingState(agentId, null);
    }
    if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
    return true;
  } catch {
    return false;
  }
}

function renderSubagentStreamingBubble(agent) {
  const streamState = getSubagentStreamingState(agent.id) || (subagentStreamingState?.agentId === agent.id ? subagentStreamingState : null);
  if (!streamState) return '';
  const color = agentColor(agent.id);
  const emoji = agentEmoji(agent);
  const liveTraceHtml = renderSubagentGroupedTrace(streamState.liveTraceEntries || streamState.processEntries || [], { streaming: true });
  const progressHtml = Array.isArray(streamState.progressLines) && streamState.progressLines.length
    ? `<div id="subagent-streaming-progress-lines" style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
        ${streamState.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const content = String(streamState.content || streamState.finalReply || '').trim();
  const elapsedSec = Math.max(1, Math.round((Date.now() - Number(streamState.startedAt || Date.now())) / 1000));
  const workLine = `<div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:6px">Working for ${formatSubagentElapsedSeconds(elapsedSec)}</div>`;
  return `
    <div class="msg ai">
      <div class="msg-avatar" style="background:${color};border-color:${color};font-size:15px">${emoji}</div>
      <div class="msg-body">
        <div class="msg-role">${escHtml(agent.name || agent.id)}</div>
        ${workLine}
        ${liveTraceHtml || progressHtml}
        ${content
          ? `<div id="subagent-streaming-text-content" class="msg-content" style="white-space:pre-wrap;word-break:break-word">${escHtml(content)}</div>`
          : (liveTraceHtml ? '' : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`)}
        <div id="subagent-streaming-process-wrapper">${renderSubagentProcessPill(streamState.processEntries || [], 'sa_stream_proc')}</div>
      </div>
    </div>
  `;
}

function refreshSubagentStreamingUI(agentId, force = false) {
  if (!activeSubagentId || activeSubagentId !== agentId || subagentDetailTab !== 'chat') return;
  const streamState = syncActiveSubagentStreamingState();
  if (!streamState || streamState.agentId !== agentId) return;
  if (force) {
    renderSubagentBoard(agentId);
  } else {
    const streamEl = document.getElementById('subagent-streaming-text-content');
    if (streamEl) {
      streamEl.textContent = String(streamState.content || streamState.finalReply || '');
    } else {
      renderSubagentBoard(agentId);
    }
    const progressEl = document.getElementById('subagent-streaming-progress-lines');
    if (progressEl) {
      const lines = Array.isArray(streamState.progressLines) ? streamState.progressLines : [];
      progressEl.innerHTML = lines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('');
    }
    const processEl = document.getElementById('subagent-streaming-process-wrapper');
    if (processEl) {
      processEl.innerHTML = renderSubagentProcessPill(streamState.processEntries || [], 'sa_stream_proc');
    }
  }
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
}

function getSubagentChatScrollSnapshot() {
  const msgs = document.getElementById('subagent-chat-messages');
  if (!msgs) return { hadChat: false, distanceFromBottom: 0, nearBottom: true };
  const distanceFromBottom = Math.max(0, msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight);
  return {
    hadChat: true,
    distanceFromBottom,
    nearBottom: distanceFromBottom < 96,
  };
}

function restoreSubagentChatScroll(snapshot, opts = {}) {
  if (subagentDetailTab !== 'chat') return;
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (!msgs) return;
    const shouldBottom = opts.forceBottom === true || !snapshot?.hadChat || snapshot?.nearBottom !== false;
    if (shouldBottom) {
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      msgs.scrollTop = Math.max(0, msgs.scrollHeight - msgs.clientHeight - Number(snapshot.distanceFromBottom || 0));
    }
  });
}

function speakSubagentVoiceReply(text) {
  const finalText = String(text || '').trim();
  if (!finalText || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(finalText);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {}
}

function captureSubagentChatDraft() {
  if (subagentDetailTab !== 'chat') return null;
  const input = document.getElementById('subagent-chat-input');
  if (!input) return null;
  subagentChatDraft = input.value || '';
  const focused = document.activeElement === input;
  return focused
    ? { focused, start: input.selectionStart, end: input.selectionEnd }
    : { focused: false };
}

function hydrateSubagentChatComposer(agentId, opts = {}) {
  if (subagentDetailTab !== 'chat') return;
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (opts.forceBottom && msgs) msgs.scrollTop = msgs.scrollHeight;

    const input = document.getElementById('subagent-chat-input');
    if (input) {
      if (input.value !== subagentChatDraft) input.value = subagentChatDraft;
      if (input.dataset.subagentDraftBound !== '1') {
        input.dataset.subagentDraftBound = '1';
        input.addEventListener('input', () => {
          subagentChatDraft = input.value;
          resizeSubagentChatInput();
          refreshSubagentChatComposerState(agentId);
        });
      }
      resizeSubagentChatInput();
      if (opts.focus || opts.selection?.focused) {
        input.focus();
        const start = Number.isFinite(opts.selection?.start) ? opts.selection.start : input.value.length;
        const end = Number.isFinite(opts.selection?.end) ? opts.selection.end : start;
        try { input.setSelectionRange(start, end); } catch {}
      }
    }

    renderSubagentChatAttachmentStaging(agentId);
    bindSubagentChatAttachmentListeners(agentId);
    refreshSubagentChatComposerState(agentId);
  });
}

function renderSubagentBoard(agentId) {
  const agent = subagentsData.find(a => a.id === agentId);
  if (!agent) return;

  const header = document.getElementById('subagent-board-header');
  const body = document.getElementById('subagent-board-body');
  if (!header || !body) return;

  const color = agentColor(agentId);
  const emoji = agentEmoji(agent);
  const chatDraftSelection = captureSubagentChatDraft();
  const chatScrollSnapshot = getSubagentChatScrollSnapshot();

  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;min-width:0">
      <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${emoji}</div>
      <div style="min-width:0">
        <div style="font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.name || agent.id)}</div>
        ${agent.description ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.description)}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      <button onclick="openSubagentSettings('${escHtml(agentId)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">Settings</button>
      <button onclick="closeSubagentDetail()" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">✕</button>
    </div>`;

  body.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--line);flex-shrink:0;overflow-x:auto;scrollbar-width:none">
      ${['overview','systemprompt','memory','heartbeat','runs','chat'].map(tab => {
        const labels = { overview:'Overview', systemprompt:'System Prompt', memory:'Memory', heartbeat:'Heartbeat', runs:`Runs (${subagentRuns.length})`, chat:'Chat' };
        const isActive = tab === subagentDetailTab;
        return `<button onclick="switchSubagentTab('${tab}','${escHtml(agentId)}')" style="padding:10px 14px;font-size:12px;font-weight:${isActive?'700':'500'};border:none;background:none;cursor:pointer;white-space:nowrap;color:${isActive?'var(--brand)':'var(--muted)'};border-bottom:2px solid ${isActive?'var(--brand)':'transparent'};margin-bottom:-1px;transition:all 0.15s">${labels[tab]}</button>`;
      }).join('')}
    </div>
    <div id="subagent-tab-content" style="flex:1;min-height:0;overflow-y:${subagentDetailTab === 'chat' ? 'hidden' : 'auto'};padding:14px 16px">
      ${renderSubagentTabContent(agent)}
    </div>`;

  if (subagentDetailTab === 'overview') {
    agentModelPickerHydrate('sa-model', agent);
    agentVoicePickerHydrate('sa-voice', agent);
  }
  restoreSubagentChatScroll(chatScrollSnapshot);
  hydrateSubagentChatComposer(agentId, { selection: chatDraftSelection });
}

function renderSubagentTabContent(agent) {
  switch (subagentDetailTab) {
    case 'overview':    return renderSubagentOverviewTab(agent);
    case 'systemprompt': return renderSubagentSystemPromptTab(agent);
    case 'memory':      return renderSubagentMemoryTab(agent);
    case 'heartbeat':   return renderSubagentHeartbeatTab(agent);
    case 'runs':        return renderSubagentRunsTab(agent);
    case 'chat':        return renderSubagentChatTab(agent);
    default: return '';
  }
}

async function switchSubagentTab(tab, agentId) {
  subagentDetailTab = tab;
  if (!subagentsData.find(a => a.id === agentId)) return;

  if (tab === 'systemprompt' && !subagentSystemPrompt) {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`);
      subagentSystemPrompt = d.content || '';
    } catch {}
  }
  if (tab === 'memory') {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`);
      subagentMemoryNotes = d.notes || '';
    } catch {}
  }
  if (tab === 'heartbeat' && !subagentHbMd) {
    try {
      const [cfgD, mdD] = await Promise.all([
        api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
        api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
      ]);
      const cfg = cfgD?.config || {};
      subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
      subagentHbMd = mdD?.content || '';
    } catch {}
  }
  if (tab === 'runs' && subagentRuns.length === 0) {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
      subagentRuns = d.runs || [];
    } catch {}
  }
  if (tab === 'chat') {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
      subagentChatHistory = preserveSubagentProcessMetadata(normalizeSubagentChatMessages(d.messages || []));
      await restoreSubagentChatApprovals(agentId);
    } catch {}
  }

  renderSubagentBoard(agentId);

  if (tab === 'chat') {
    hydrateSubagentChatComposer(agentId, { focus: true, forceBottom: true });
  }
}

// ── Inline model picker (shared component) ──────────────────────────────────
async function _refreshSubagentEntry(agentId) {
  try {
    const data = await api('/api/agents');
    const agents = data?.agents || [];
    const updated = agents.find(a => a.id === agentId);
    if (updated) {
      const idx = subagentsData.findIndex(a => a.id === agentId);
      if (idx >= 0) subagentsData[idx] = updated; else subagentsData.push(updated);
    }
  } catch {}
}

registerAgentModelPickerOnSaved('sa-model', async (agentId) => {
  await _refreshSubagentEntry(agentId);
  if (subagentDetailTab === 'overview' && activeSubagentId === agentId) {
    renderSubagentBoard(agentId);
  }
});

registerAgentVoicePickerOnSaved('sa-voice', async (agentId) => {
  await _refreshSubagentEntry(agentId);
  if (subagentDetailTab === 'overview' && activeSubagentId === agentId) {
    renderSubagentBoard(agentId);
  }
});

// ── Tab Renderers ─────────────────────────────────────────────────────────────
function renderSubagentOverviewTab(agent) {
  const color = agentColor(agent.id);
  const lastRunEntry = subagentRuns[0];
  const nextRun = agent.cronSchedule ? `<code style="background:var(--panel-2);padding:2px 6px;border-radius:4px;font-size:11px">${escHtml(agent.cronSchedule)}</code>` : '<span style="color:var(--muted)">Not scheduled</span>';

  const infoRows = [
    ['Agent ID', `<code style="font-size:11px;background:var(--panel-2);padding:2px 6px;border-radius:4px">${escHtml(agent.id)}</code>`],
    ['Model', agent.effectiveModel ? `<span style="font-size:12px">${escHtml(agent.effectiveModel)}<span style="font-size:10px;color:var(--muted);margin-left:5px">(${escHtml(agent.effectiveModelSource||'')})</span></span>` : '<span style="color:var(--muted)">Inherited</span>'],
    ['Schedule', nextRun],
    ['Last Run', lastRunEntry ? `<span style="font-size:12px">${timeAgo(lastRunEntry.finishedAt)} · ${lastRunEntry.success?'✅':'❌'} · ${lastRunEntry.stepCount||0} steps</span>` : '<span style="color:var(--muted)">Never</span>'],
  ];
  if (agent.marketplaceProfile?.packId) {
    infoRows.splice(1, 0, ['Profile Pack', `<div style="display:flex;flex-direction:column;gap:2px"><strong>${escHtml(agent.marketplaceProfile.packId)}</strong><span style="color:var(--muted);font-size:10px">v${escHtml(agent.marketplaceProfile.packVersion || 'unknown')} · ${escHtml(agent.marketplaceProfile.publisher || 'unknown publisher')} · ${escHtml(agent.marketplaceProfile.scannerStatus || 'local')}</span></div>`]);
  }

  const attachedSkillIds = Array.isArray(agent.skillIds) ? agent.skillIds : [];
  const attachedSkills = attachedSkillIds.map(id => subagentSkillsCache.find(s => s.id === id) || { id, name: id, description: 'Missing from current skill registry' });
  const selectedSkillsHtml = attachedSkills.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${attachedSkills.map(skill => `
          <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 8px;font-size:11px;max-width:100%">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${escHtml(skill.name || skill.id)}</span>
            <button type="button" onclick="removeSubagentSkill('${escHtml(agent.id)}','${escHtml(skill.id)}')" style="border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0" title="Remove skill">&times;</button>
          </span>`).join('')}
      </div>`
    : `<div style="border:1px dashed var(--line);border-radius:8px;padding:10px;font-size:11px;color:var(--muted);background:var(--panel-2);margin-top:8px">No skills attached yet.</div>`;
  const availableSkills = subagentSkillsCache.filter(skill => skill?.id && !attachedSkillIds.includes(skill.id));
  const skillsPickerHtml = availableSkills.length
    ? `<div style="display:flex;gap:6px;margin-top:8px">
        <select id="sa-skill-select-${escHtml(agent.id)}" style="flex:1;border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;background:var(--panel);color:var(--text)">
          <option value="">Attach installed skill…</option>
          ${availableSkills.map(skill => `<option value="${escHtml(skill.id)}">${escHtml(skill.name || skill.id)}</option>`).join('')}
        </select>
        <button type="button" onclick="addSubagentSkill('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">Attach</button>
      </div>`
    : `<div style="font-size:10px;color:var(--muted);margin-top:8px">All installed skills are already attached.</div>`;

  // Context reference cards
  const refsHtml = subagentContextRefs.length === 0
    ? `<div style="border:1px dashed var(--line);border-radius:8px;padding:12px;font-size:11px;color:var(--muted);background:var(--panel-2)">No context references yet. Add one above — it will be injected when this agent is spawned.</div>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${subagentContextRefs.map(ref => {
          const preview = String(ref.content||'').replace(/\s+/g,' ').slice(0,120);
          const fileIcon = ref.isFile ? '📎 ' : '';
          return `<button onclick="openSubagentCtxRefModal('${escHtml(agent.id)}','${escHtml(ref.id)}')" style="text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:9px;cursor:pointer;display:flex;flex-direction:column;gap:5px;min-height:100px">
            <div style="font-size:11px;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${fileIcon}${escHtml(ref.title||'Untitled')}</div>
            <div style="font-size:10px;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">${escHtml(preview||'(empty)')}</div>
            <div style="margin-top:auto;font-size:9px;color:var(--muted)">${timeAgo(ref.updatedAt||ref.createdAt||Date.now())}</div>
          </button>`;
        }).join('')}
      </div>`;

  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="flex-shrink:0">${drawAgentSVG(agent, true, 0.8)}</div>
        <div>
          <div style="font-size:15px;font-weight:800;margin-bottom:3px">${escHtml(agent.name||agent.id)}</div>
          ${agent.description ? `<div style="font-size:12px;color:var(--muted);line-height:1.5">${escHtml(agent.description)}</div>` : ''}
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${agent.cronSchedule ? `<span style="font-size:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:2px 8px;font-weight:700">⏰ Scheduled</span>` : ''}
            <span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:999px;padding:2px 8px;border:1px solid #bcd4f8;font-weight:700">Standalone</span>
            ${agent.marketplaceProfile?.packId ? `<span style="font-size:10px;background:#fff7ed;color:#9a3412;border-radius:999px;padding:2px 8px;border:1px solid #fed7aa;font-weight:800">Marketplace Pack</span>` : ''}
          </div>
        </div>
      </div>

      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:12px;overflow:hidden">
        ${infoRows.map(([label, value], i) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 14px;${i>0?'border-top:1px solid var(--line)':''}">
            <div style="font-size:11px;font-weight:700;color:var(--muted);min-width:80px;flex-shrink:0;padding-top:1px">${label}</div>
            <div style="font-size:12px;color:var(--text);flex:1">${value}</div>
          </div>`).join('')}
      </div>

      ${_renderAgentModelPicker(agent, 'sa-model')}
      ${_renderAgentVoicePicker(agent, 'sa-voice')}

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Attached Skills</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Attached playbooks are surfaced when this agent runs.</div>
          </div>
          <button type="button" onclick="reloadSubagentSkills('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:7px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer">Refresh</button>
        </div>
        ${selectedSkillsHtml}
        ${skillsPickerHtml}
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="spawnSubagentTask('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">▶ Run Task</button>
        <button onclick="switchSubagentTab('chat','${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer">💬 Chat</button>
        <button onclick="refreshSubagentDetail('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">↻</button>
        ${agent.marketplaceProfile?.packId ? `<button onclick="uninstallAgentProfilePack('${escHtml(agent.id)}')" style="border:1px solid #fecaca;background:#fff1f2;color:#991b1b;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer">Uninstall Pack</button>` : ''}
      </div>

      <!-- Context References -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Context &amp; Reference</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Cards are injected as context when this agent is spawned.</div>
          </div>
          <label style="flex-shrink:0;cursor:pointer;border:1px solid var(--line);background:var(--panel-2);border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--muted)">
            📎 Upload File
            <input type="file" style="display:none" onchange="uploadSubagentContextFile('${escHtml(agent.id)}',this)" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:8px">
          <input id="sa-ctx-title-${escHtml(agent.id)}" type="text" placeholder="Reference title…" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;background:var(--panel);color:var(--text)" />
          <textarea id="sa-ctx-content-${escHtml(agent.id)}" rows="2" placeholder="Reference content…" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;background:var(--panel);color:var(--text);resize:vertical"></textarea>
          <button onclick="saveSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;align-self:flex-end">Save Reference</button>
        </div>
        ${refsHtml}

        <!-- Edit modal -->
        <div id="sa-ctx-modal-${escHtml(agent.id)}" style="display:none;position:fixed;inset:0;background:rgba(10,20,40,0.42);z-index:9999;align-items:center;justify-content:center;padding:16px">
          <div style="width:min(580px,96vw);max-height:88vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-md);padding:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-size:13px;font-weight:800">Edit Context Reference</div>
              <button onclick="closeSubagentCtxRefModal('${escHtml(agent.id)}')" style="border:0;background:none;font-size:18px;cursor:pointer;color:var(--muted)">&#x2715;</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <input id="sa-ctx-modal-title-${escHtml(agent.id)}" type="text" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--panel-2);color:var(--text)" />
              <textarea id="sa-ctx-modal-content-${escHtml(agent.id)}" rows="10" style="border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);resize:vertical;line-height:1.5"></textarea>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <button onclick="deleteSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid #f2c5c5;background:#fff5f5;color:#b42323;border-radius:7px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">Delete</button>
                <div style="display:flex;gap:6px">
                  <button onclick="closeSubagentCtxRefModal('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">Close</button>
                  <button onclick="updateSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderSubagentSystemPromptTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">System Prompt</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Defines this agent's persona, goals, and constraints</div>
        </div>
        <button onclick="saveSubagentSystemPrompt('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">Save</button>
      </div>
      <textarea id="subagent-system-prompt-editor" style="flex:1;min-height:300px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;outline:none" placeholder="Enter system prompt for this agent…">${escHtml(subagentSystemPrompt)}</textarea>
    </div>`;
}

function renderSubagentMemoryTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">Memory</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Latest notes from this agent's memory directory</div>
        </div>
        <button onclick="reloadSubagentMemory('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">↻ Reload</button>
      </div>
      ${subagentMemoryNotes
        ? `<div style="flex:1;min-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(subagentMemoryNotes)}</div>`
        : `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;padding:48px;text-align:center">
            <div>
              <div style="font-size:32px;margin-bottom:10px">🧠</div>
              <div style="font-weight:700;margin-bottom:6px">No memory yet</div>
              <div style="font-size:12px">Memory notes are written by this agent during runs and appear here.</div>
            </div>
          </div>`
      }
    </div>`;
}

function renderSubagentHeartbeatTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">💓 Heartbeat</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Scheduled recurring task for this agent</div>
        </div>
        <button onclick="tickSubagentHbFromDetail('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">▶ Run Now</button>
      </div>

      <div style="display:flex;align-items:center;gap:14px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px">
        <label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="sa-hb-enabled-${escHtml(agent.id)}" ${subagentHbConfig.enabled ? 'checked' : ''} style="width:15px;height:15px" />
          Enabled
        </label>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--muted)">Every</span>
          <input type="number" id="sa-hb-interval-${escHtml(agent.id)}" min="1" max="1440" value="${subagentHbConfig.intervalMinutes||30}" style="width:56px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;text-align:center" />
          <span style="font-size:12px;color:var(--muted)">min</span>
        </div>
        <button onclick="saveSubagentHbConfig('${escHtml(agent.id)}')" style="margin-left:auto;border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer">Save Config</button>
      </div>

      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">HEARTBEAT.md — what this agent does when woken</div>
        <textarea id="sa-hb-md-${escHtml(agent.id)}" style="width:100%;min-height:260px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;outline:none;box-sizing:border-box" placeholder="Describe what this agent should do on each heartbeat run…">${escHtml(subagentHbMd)}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button onclick="saveSubagentHbMd('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">Save HEARTBEAT.md</button>
          <button onclick="reloadSubagentHb('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">↻ Reload</button>
        </div>
        <div id="sa-hb-status-${escHtml(agent.id)}" style="margin-top:5px;font-size:11px;color:var(--muted)"></div>
      </div>
    </div>`;
}

function subagentRunStatusMeta(status) {
  const s = String(status || '').toLowerCase();
  if (['running', 'queued', 'waiting_subagent'].includes(s)) return { group: 'Running', label: s.replace(/_/g, ' '), color: '#0d4faf', bg: '#eaf2ff' };
  if (['needs_assistance', 'awaiting_user_input', 'stalled'].includes(s)) return { group: 'Needs Attention', label: s.replace(/_/g, ' '), color: '#9a3412', bg: '#fff7ed' };
  if (s === 'paused') return { group: 'Paused', label: 'paused', color: '#7c4d00', bg: '#fff8e1' };
  if (s === 'complete') return { group: 'Completed', label: 'complete', color: '#166534', bg: '#dcfce7' };
  if (s === 'failed') return { group: 'Failed', label: 'failed', color: '#991b1b', bg: '#fee2e2' };
  return { group: 'Other', label: s || 'unknown', color: 'var(--muted)', bg: 'var(--panel)' };
}

function renderSubagentRunProgress(taskOrRun) {
  const task = taskOrRun || {};
  const plan = Array.isArray(task.plan) ? task.plan : [];
  const runtimeItems = Array.isArray(task.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  const items = plan.length
    ? plan.map((step, idx) => ({
        text: step.description || step.text || step.title || `Step ${idx + 1}`,
        status: step.status || 'pending',
      }))
    : runtimeItems.map((item, idx) => ({ text: item.text || `Step ${idx + 1}`, status: item.status || 'pending' }));
  if (!items.length) return `<div style="font-size:12px;color:var(--muted)">No plan steps recorded yet.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:7px">${items.slice(0, 20).map((item, idx) => {
    const raw = String(item.status || '').toLowerCase();
    const done = raw === 'done' || raw === 'skipped';
    const failed = raw === 'failed';
    const active = raw === 'running' || raw === 'in_progress';
    const color = failed ? '#b42323' : done ? '#166534' : active ? '#0d4faf' : 'var(--muted)';
    return `<div style="display:grid;grid-template-columns:24px 1fr;gap:8px;align-items:start">
      <span style="width:21px;height:21px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);background:${active ? '#eaf2ff' : done ? '#dcfce7' : failed ? '#fee2e2' : 'var(--panel)'};color:${color};font-size:10px;font-weight:900">${done ? 'OK' : failed ? '!' : idx + 1}</span>
      <span style="font-size:12px;line-height:1.45;color:var(--text);overflow-wrap:anywhere">${escHtml(item.text)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderSubagentRunRecovery(task, agentId) {
  const canRecover = !!task?.canRecover || ['needs_assistance', 'awaiting_user_input', 'paused', 'stalled', 'failed'].includes(String(task?.status || '').toLowerCase());
  const turns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation.slice(-16) : [];
  const pauseMessage = String(task?.pauseAnalysis?.message || '').trim();
  const pending = String(task?.pendingClarificationQuestion || '').trim();
  const taskId = String(task?.id || task?.taskId || '');
  const recoveryTurnsHtml = turns.length
    ? turns.map((turn) => {
        const isUser = turn?.role === 'user';
        return `<div style="align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:92%;background:${isUser ? 'rgba(251,146,60,.14)' : 'var(--panel)'};border:1px solid var(--line);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;font-weight:900;text-transform:uppercase;color:var(--muted);margin-bottom:4px">${isUser ? 'You' : 'Recovery'}</div>
          <div style="font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(turn?.content || '')}</div>
        </div>`;
      }).join('')
    : `<div style="font-size:12px;color:var(--muted)">No recovery messages yet.</div>`;
  return `
    <section style="border:1px solid ${canRecover ? '#fed7aa' : 'var(--line)'};background:${canRecover ? 'rgba(255,247,237,.7)' : 'var(--panel-2)'};border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="font-size:12px;font-weight:900;color:${canRecover ? '#9a3412' : 'var(--text)'}">Recovery Chat</div>
        <span style="font-size:10px;color:var(--muted)">${canRecover ? 'task mode' : 'read only'}</span>
      </div>
      ${pending ? `<div style="font-size:12px;line-height:1.45"><strong>Pending question:</strong> ${escHtml(pending)}</div>` : ''}
      ${pauseMessage ? `<div style="font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere"><strong>Pause analysis:</strong><br>${escHtml(pauseMessage.slice(0, 1400))}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px">${recoveryTurnsHtml}</div>
      ${canRecover ? `<div style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="sa-run-recovery-${escHtml(taskId)}" rows="2" placeholder="Reply to this run..." style="flex:1;min-height:54px;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel);color:var(--text)"></textarea>
        <button onclick="sendSubagentRunRecovery('${escHtml(agentId)}','${escHtml(taskId)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer">Send</button>
      </div>` : ''}
    </section>`;
}

function renderSubagentRunDetail(agent, run) {
  const taskId = String(run?.id || run?.taskId || '');
  const detail = subagentRunDetails[taskId]?.task;
  const loading = subagentRunDetails[taskId]?.loading;
  if (loading || !detail) {
    return `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;font-size:12px;color:var(--muted)">Loading run details...</div>`;
  }
  const journal = Array.isArray(detail.journal) ? detail.journal.slice(-30).reverse() : [];
  return `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:12px">
    ${detail.finalSummary ? `<section><div style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Output</div><div style="font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(detail.finalSummary)}</div></section>` : ''}
    ${renderSubagentRunRecovery({ ...run, ...detail }, agent.id)}
    <section><div style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Progress</div>${renderSubagentRunProgress(detail)}</section>
    <section><div style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Task Prompt</div><div style="font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(detail.prompt || detail.title || '')}</div></section>
    <section><div style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Process Log</div>
      ${journal.length ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;border:1px solid var(--line);border-radius:8px;overflow:hidden">${journal.map((entry) => `<div style="display:grid;grid-template-columns:58px 82px 1fr;gap:6px;padding:7px 8px;border-bottom:1px solid var(--line)">
        <span style="color:var(--muted)">${entry?.t ? new Date(entry.t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''}</span>
        <span style="font-weight:900;color:${entry?.type === 'error' ? '#b42323' : 'var(--muted)'}">${escHtml(entry?.type || 'event')}</span>
        <span style="white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(entry?.content || entry?.detail || '')}</span>
      </div>`).join('')}</div>` : `<div style="font-size:12px;color:var(--muted)">No process log entries yet.</div>`}
    </section>
  </div>`;
}

function renderSubagentRunsTab(agent) {
  if (subagentRuns.length === 0) {
    return `<div style="text-align:center;color:var(--muted);padding:48px 16px">
      <div style="font-size:36px;margin-bottom:10px">📭</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">No runs yet</div>
      <div style="font-size:12px">Background task runs for this agent will appear here.</div>
    </div>`;
  }

  const groups = ['Needs Attention', 'Paused', 'Running', 'Failed', 'Completed', 'Other'];
  const byGroup = new Map(groups.map((group) => [group, []]));
  subagentRuns.forEach((run) => {
    const meta = subagentRunStatusMeta(run.status || run.taskStatus);
    if (!byGroup.has(meta.group)) byGroup.set(meta.group, []);
    byGroup.get(meta.group).push(run);
  });

  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-size:13px;font-weight:900;color:var(--text)">Runs</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Task work, status, output, and recovery stay here.</div>
        </div>
        <button onclick="reloadSubagentRuns('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer">Refresh</button>
      </div>
      ${groups.map((group) => {
        const runs = byGroup.get(group) || [];
        if (!runs.length) return '';
        return `<section style="display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">${group} (${runs.length})</div>
          ${runs.map((run) => {
            const meta = subagentRunStatusMeta(run.status || run.taskStatus);
            const taskId = String(run.id || run.taskId || '');
            const open = activeSubagentRunId === taskId;
            const title = String(run.title || run.taskName || run.prompt || 'Task');
            const preview = String(run.resultPreview || run.finalSummary || run.pauseAnalysis?.message || run.prompt || '').trim();
            const started = Number(run.startedAt || 0);
            const updated = Number(run.lastProgressAt || run.completedAt || started || 0);
            return `<article style="background:var(--panel-2);border:1px solid ${open ? 'var(--brand)' : 'var(--line)'};border-radius:10px;padding:11px 13px;cursor:pointer" onclick="openSubagentRunDetail('${escHtml(agent.id)}','${escHtml(taskId)}')">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
                <div style="min-width:0;flex:1">
                  <div style="font-size:12px;font-weight:900;color:var(--text);line-height:1.35;overflow-wrap:anywhere">${escHtml(title.slice(0, 160))}${title.length > 160 ? '...' : ''}</div>
                  <div style="font-size:10px;color:var(--muted);margin-top:3px">${escHtml(run.trigger || run.source || 'manual')} · ${run.completedSteps || 0}/${run.totalSteps || run.stepCount || 0} steps · ${updated ? timeAgo(updated) : ''}</div>
                </div>
                <span style="font-size:10px;font-weight:900;color:${meta.color};background:${meta.bg};border:1px solid ${meta.color};border-radius:999px;padding:3px 7px;white-space:nowrap">${escHtml(meta.label)}</span>
              </div>
              ${preview ? `<div style="font-size:11px;color:var(--text);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;opacity:.84">${escHtml(preview.slice(0, 320))}${preview.length > 320 ? '...' : ''}</div>` : ''}
              ${run.canRecover ? `<div style="margin-top:8px;font-size:11px;font-weight:900;color:#9a3412">Needs recovery input</div>` : ''}
              ${open ? renderSubagentRunDetail(agent, run) : ''}
            </article>`;
          }).join('')}
        </section>`;
      }).join('')}
    </div>`;
}

function renderSubagentChatTab(agent) {
  const liveStream = getSubagentStreamingState(agent.id);
  const isSending = !!(liveStream && liveStream.completed !== true);
  const queuedCount = getSubagentChatQueue(agent.id).length;
  const emoji = agentEmoji(agent);
  const approvalsHtml = renderSubagentChatApprovals(agent.id);
  const renderedMessages = subagentChatHistory.map(m => {
    const isUser = m.role === 'user';
    const rawSource = String(m.metadata?.source || '');
    const isDirectUserMessage = isUser && (!rawSource || rawSource === 'subagent_chat');
    const label = isDirectUserMessage
      ? 'You'
      : isUser && rawSource === 'schedule'
        ? 'Scheduled task'
        : isUser && (rawSource.includes('team') || rawSource === 'talk_to_subagent')
          ? 'Manager'
          : isUser
            ? 'Prometheus'
            : (m.role === 'system' ? 'System' : escHtml(agent.name||agent.id));
    const source = rawSource === 'schedule' ? 'scheduled' : rawSource && rawSource !== 'subagent_chat' ? rawSource.replace(/_/g, ' ') : '';
    const stepCount = m.steps || m.metadata?.stepCount;
    const durationSec = m.duration || (m.metadata?.durationMs ? Math.round(m.metadata.durationMs / 1000) : 0);
    const processHtml = !isUser ? renderSubagentProcessPill(m.metadata?.processEntries || [], 'sa_msg_proc') : '';
    const attachments = Array.isArray(m.metadata?.attachmentPreviews) ? m.metadata.attachmentPreviews : [];
    const visibleContent = stripSubagentUploadNote(m.content, attachments);
    const contentHtml = isUser
      ? `<div class="msg-content">${!isDirectUserMessage ? `<div style="font-size:11px;font-weight:800;margin-bottom:6px;opacity:0.78">${label}${source ? ` · ${source}` : ''}</div>` : ''}${renderSubagentAttachmentPreviews(attachments, agent.id, m.id)}${visibleContent ? escHtml(visibleContent) : ''}</div>`
      : `<div class="msg-content markdown-body">${typeof marked !== 'undefined' ? marked.parse(m.content) : escHtml(m.content)}</div>`;
    const workHtml = !isUser ? renderSubagentWorkTimer(m, durationSec) : '';
    const traceDrawerHtml = !isUser ? renderSubagentTraceDrawer(m) : '';
    const metaHtml = stepCount ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">${stepCount} steps${durationSec ? ` · ${formatSubagentElapsedSeconds(durationSec)}` : ''}</div>` : '';
    return `
      <div class="msg ${isUser ? 'user' : 'ai'}">
        ${!isUser ? `<div class="msg-avatar" style="background:${agentColor(agent.id)};border-color:${agentColor(agent.id)};font-size:15px">${agentEmoji(agent)}</div>` : ''}
        <div class="msg-body">
          ${!isUser ? `<div class="msg-role">${label} · <span style="font-weight:400;opacity:0.75">${timeAgo(m.ts)}${source ? ` · ${source}` : ''}</span></div>` : ''}
          ${workHtml}
          ${traceDrawerHtml}
          ${contentHtml}
          ${processHtml}
          ${metaHtml}
        </div>
      </div>`;
  }).join('');
  return `
    <div id="subagent-chat-tab-shell" class="panel-chat-shell subagent-panel-chat-shell" style="position:relative;display:flex;flex-direction:column;height:100%;gap:0">
      <div id="subagent-chat-messages" class="subagent-panel-chat-messages" style="flex:1;display:flex;flex-direction:column;align-items:center;width:100%;gap:18px;overflow-y:auto;padding:16px 0 8px">
        ${subagentChatHistory.length === 0 && !approvalsHtml ? `
          <div style="text-align:center;color:var(--muted);padding:32px 16px;font-size:13px">
            <div style="font-size:32px;margin-bottom:10px">${emoji}</div>
            <div style="font-weight:700;margin-bottom:6px">Chat with ${escHtml(agent.name||agent.id)}</div>
            <div style="font-size:12px;line-height:1.5">Send a message to interact directly with this agent. Each message spawns the agent with the full conversation as context.</div>
          </div>` : ''}
        ${renderedMessages}
        ${liveStream ? renderSubagentStreamingBubble(agent) : ''}
        ${approvalsHtml}
      </div>
      <div class="chat-input-area panel-chat-composer subagent-panel-chat-composer" style="flex-shrink:0">
        <input id="subagent-chat-file-input" type="file" multiple style="display:none" onchange="onSubagentChatFilesChosen(${subagentChatJsArg(agent.id)}, this)" />
        <div id="subagent-chat-composer" style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div id="subagent-chat-queue-badge" style="display:${queuedCount ? 'inline-flex' : 'none'};align-self:flex-start;align-items:center;border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:999px;padding:3px 9px;font-size:11px;font-weight:800">${queuedCount} queued</div>
          <div id="subagent-chat-file-staging" class="chat-file-staging panel-chat-file-staging" style="display:none"></div>
          <div class="chat-input-row" style="align-items:flex-end">
            <button type="button" class="chat-attach-btn panel-chat-attach-btn" title="Attach files" aria-label="Attach files" onclick="openSubagentChatFilePicker()">
              <iconify-icon icon="solar:paperclip-bold-duotone" width="17" height="17"></iconify-icon>
            </button>
            <button type="button" id="subagent-chat-voice-button" class="chat-voice-btn" title="Start voice mode" aria-label="Start voice mode" onclick="startSubagentDesktopVoice(${subagentChatJsArg(agent.id)})">
              <iconify-icon icon="solar:microphone-3-bold-duotone" width="18" height="18"></iconify-icon>
            </button>
            <textarea id="subagent-chat-input" rows="1" placeholder="${isSending ? `Queue a message for ${escHtml(agent.name||agent.id)}...` : `Message ${escHtml(agent.name||agent.id)}...`}" class="chat-textarea" style="min-height:42px;max-height:150px" onpaste="handleSubagentChatPaste(event, ${subagentChatJsArg(agent.id)})" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSubagentChat(${subagentChatJsArg(agent.id)});}">${escHtml(subagentChatDraft)}</textarea>
            <button id="subagent-chat-send-button" class="send-btn" onclick="${isSending ? `abortSubagentChat('${escHtml(agent.id)}')` : `sendSubagentChat('${escHtml(agent.id)}')`}" title="${isSending ? 'Stop' : 'Send'}">
              ${isSending ? '<iconify-icon icon="solar:stop-bold" width="20" height="20"></iconify-icon>' : '<iconify-icon icon="solar:arrow-up-bold" width="20" height="20"></iconify-icon>'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

async function reloadSubagentRuns(agentId) {
  try {
    const data = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
    subagentRuns = Array.isArray(data?.runs) ? data.runs : [];
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Runs error', err.message || 'Failed to load runs', 'error');
  }
}

async function openSubagentRunDetail(agentId, taskId) {
  const id = String(taskId || '').trim();
  if (!id) return;
  activeSubagentRunId = activeSubagentRunId === id ? '' : id;
  if (activeSubagentRunId && !subagentRunDetails[id]?.task) {
    subagentRunDetails[id] = { loading: true };
    renderSubagentBoard(agentId);
    try {
      const data = await api(`/api/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(id)}`);
      subagentRunDetails[id] = { task: data.task || null, run: data.run || null, evidenceBus: data.evidenceBus || null };
    } catch (err) {
      subagentRunDetails[id] = { task: null, error: err.message || 'Failed to load run' };
      showToast('Run error', err.message || 'Failed to load run', 'error');
    }
  }
  renderSubagentBoard(agentId);
}

async function sendSubagentRunRecovery(agentId, taskId) {
  const id = String(taskId || '').trim();
  const textarea = document.getElementById(`sa-run-recovery-${id}`);
  const message = String(textarea?.value || '').trim();
  if (!id || !message) return;
  try {
    const data = await api(`/api/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(id)}/recovery`, {
      method: 'POST',
      body: JSON.stringify({ message }),
      timeoutMs: 300000,
    });
    if (textarea) textarea.value = '';
    if (data?.task) subagentRunDetails[id] = { task: data.task, run: data.run || null, evidenceBus: data.evidenceBus || null };
    const runsData = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`).catch(() => null);
    if (Array.isArray(runsData?.runs)) subagentRuns = runsData.runs;
    showToast('Recovery updated', data?.resumed ? 'Run resumed' : 'Reply sent', 'success');
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Recovery error', err.message || 'Failed to send recovery reply', 'error');
  }
}

function startSubagentDesktopVoice(agentId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice unavailable', 'This browser does not expose speech recognition for desktop subagent chat.', 'warning');
    return;
  }
  const btn = document.getElementById('subagent-chat-voice-button');
  try {
    const recognition = new SpeechRecognition();
    let finalTranscript = '';
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      btn?.classList.add('recording');
      showToast('Listening', `Talk to ${getActiveSubagentName(agentId)}.`, 'info');
    };
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = String(event.results[i][0]?.transcript || '');
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      const input = document.getElementById('subagent-chat-input');
      if (input) {
        input.value = `${finalTranscript}${interim}`.trim();
        subagentChatDraft = input.value;
        resizeSubagentChatInput();
        refreshSubagentChatComposerState(agentId);
      }
    };
    recognition.onerror = (event) => {
      showToast('Voice error', event?.error || 'Could not capture speech.', 'error');
    };
    recognition.onend = () => {
      btn?.classList.remove('recording');
      const text = String(finalTranscript || document.getElementById('subagent-chat-input')?.value || '').trim();
      if (!text) return;
      subagentDesktopVoiceTargetAgentId = agentId;
      sendSubagentChat(agentId);
    };
    recognition.start();
  } catch (err) {
    btn?.classList.remove('recording');
    showToast('Voice error', err?.message || 'Could not start speech recognition.', 'error');
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function sendSubagentChat(agentId, queuedMessage = null) {
  const inp = document.getElementById('subagent-chat-input');
  const fromQueue = queuedMessage !== null && queuedMessage !== undefined;
  if (!inp && !fromQueue) return;
  await waitForSubagentChatFileStaging(agentId);
  const queuedTurn = fromQueue && typeof queuedMessage === 'object' && !Array.isArray(queuedMessage)
    ? queuedMessage
    : { content: queuedMessage, files: [] };
  const filesToUpload = fromQueue ? (Array.isArray(queuedTurn.files) ? queuedTurn.files.slice() : []) : getSubagentPendingFiles(agentId).slice();
  const rawMsg = fromQueue ? String(queuedTurn.content || '').trim() : String(inp?.value || '').trim();
  const msg = rawMsg || (filesToUpload.length ? 'Please review the attached file(s).' : '');
  if (!msg && !filesToUpload.length) {
    startSubagentDesktopVoice(agentId);
    return;
  }

  if (isSubagentChatBusy(agentId)) {
    const queued = queueSubagentChatMessage(agentId, msg, filesToUpload);
    if (queued && !fromQueue && inp) {
      inp.value = '';
      subagentChatDraft = '';
      subagentChatPendingFilesByAgent[agentId] = [];
      renderSubagentChatAttachmentStaging(agentId);
    }
    if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
    requestAnimationFrame(() => {
      const newInp = document.getElementById('subagent-chat-input');
      if (newInp) newInp.focus();
    });
    return;
  }

  let messageForRuntime = msg;
  let attachmentPreviews = subagentStagedFilesToAttachmentPreviews(filesToUpload);
  if (!fromQueue) {
    subagentChatPendingFilesByAgent[agentId] = [];
    renderSubagentChatAttachmentStaging(agentId);
  }
  if (filesToUpload.length) {
    const uploadResults = await uploadSubagentChatStagedFiles(filesToUpload);
    const fileContextNote = buildSubagentFileContextNote(uploadResults);
    attachmentPreviews = subagentUploadResultsToAttachmentPreviews(uploadResults);
    messageForRuntime = fileContextNote ? `${msg}${fileContextNote}` : msg;
  }

  if (inp && !fromQueue) inp.value = '';
  if (!fromQueue) subagentChatDraft = '';
  _subagentChatSending = true;

  subagentChatHistory.push({ id: `pending_${Date.now()}`, role: 'user', content: messageForRuntime, ts: Date.now(), metadata: { pending: true, attachmentPreviews } });

  const startTs = Date.now();
  const streamState = {
    agentId,
    content: '',
    thinking: '',
    processEntries: [],
    progressLines: [`${getActiveSubagentName(agentId)} is thinking...`],
    completed: false,
    finalReply: '',
    fallbackTimer: null,
    source: 'localSse',
    startedAt: startTs,
  };
  setSubagentStreamingState(agentId, streamState);
  renderSubagentBoard(agentId);
  const controller = new AbortController();
  subagentChatAbortControllers[agentId] = controller;
  let wasAborted = false;

  // Scroll to bottom
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
      body: JSON.stringify({
        message: messageForRuntime,
        attachmentPreviews,
        timeoutMs: 300000,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body from stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        if (getSubagentStreamingState(agentId) !== streamState) continue;

        switch (event.type) {
          case 'token': {
            const chunk = String(event.text || '');
            if (!chunk) break;
            if (!streamState.finalResponseStarted && !streamState.toolActivityStarted) {
              appendSubagentLiveTrace(streamState, 'preamble', chunk, { append: true });
            } else {
              streamState.finalResponseStarted = true;
              streamState.content = `${streamState.content || ''}${chunk}`;
            }
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'thinking_delta': {
            const chunk = String(event.thinking || event.text || '');
            if (!chunk) break;
            streamState.thinking = `${streamState.thinking || ''}${chunk}`;
            if (!streamState.progressLines?.some((line) => /^Thinking/i.test(String(line)))) {
              pushSubagentProgressLine('Thinking...', streamState);
            }
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'thinking':
          case 'agent_thought': {
            const thought = String(event.thinking || event.text || '').trim();
            if (!thought) break;
            streamState.thinking = streamState.thinking
              ? `${streamState.thinking}\n\n${thought}`
              : thought;
            addSubagentProcessEntry('think', thought, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'info': {
            const info = String(event.message || '').trim();
            if (!info) break;
            pushSubagentProgressLine(info, streamState);
            addSubagentProcessEntry('info', info, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'heartbeat': {
            const heartbeatMsg = String(event.message || event.current_step || event.state || '').trim();
            if (!heartbeatMsg) break;
            if (!/^processing$/i.test(heartbeatMsg)) {
              pushSubagentProgressLine(heartbeatMsg, streamState);
            }
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'progress_state': {
            const items = Array.isArray(event.items) ? event.items : [];
            const activeIndex = Number(event.activeIndex || -1);
            const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
            const activeText = String(activeItem?.text || '').trim();
            if (activeText) {
              pushSubagentProgressLine(activeText, streamState);
            } else if (event.reason === 'request_start' && streamState.progressLines?.[0] === 'Connecting...') {
              streamState.progressLines = [`${getActiveSubagentName(agentId)} is thinking...`];
              refreshSubagentStreamingUI(agentId);
            }
            break;
          }

          case 'tool_call': {
            const action = String(event.action || '').trim();
            if (!action) break;
            const stepNum = Number(event.stepNum || 0);
            const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
            const args = (event.args && typeof event.args === 'object') ? event.args : null;
            const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
            moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
            streamState.toolActivityStarted = true;
            pushSubagentProgressLine(`${stepPrefix}Running ${action}...`, streamState);
            addSubagentProcessEntry(
              'tool',
              `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
              (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
              streamState,
            );
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'tool_result': {
            const action = String(event.action || '').trim() || 'tool';
            const stepNum = Number(event.stepNum || 0);
            const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
            const text = String(event.result || '').trim();
            const ok = event.error === true ? false : !/^ERROR:/i.test(text);
            moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
            streamState.toolActivityStarted = true;
            pushSubagentProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`, streamState);
            addSubagentProcessEntry(
              ok ? 'result' : 'error',
              `${stepPrefix}${action} => ${text || '(no output)'}`,
              event.actor ? { actor: event.actor } : undefined,
              streamState,
            );
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'tool_progress': {
            const action = String(event.action || '').trim();
            const progressMsg = String(event.message || '').trim();
            if (!action || !progressMsg) break;
            moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
            streamState.toolActivityStarted = true;
            pushSubagentProgressLine(`${action}: ${progressMsg}`, streamState);
            addSubagentProcessEntry('info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'final': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
              addSubagentProcessEntry('final', reply, undefined, streamState);
              refreshSubagentStreamingUI(agentId, true);
            }
            break;
          }

          case 'done': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
            }
            const thinking = String(event.thinking || '').trim();
            if (thinking && !String(streamState.thinking || '').includes(thinking)) {
              streamState.thinking = streamState.thinking
                ? `${streamState.thinking}\n\n${thinking}`
                : thinking;
            }
            streamState.completed = true;
            if (!commitSubagentStreamingReply(agentId, streamState, streamState.finalReply || streamState.content || reply, startTs, { streamDone: true })) {
              refreshSubagentStreamingUI(agentId, true);
            } else {
              scheduleNextSubagentQueuedMessage(agentId);
            }
            break;
          }

          case 'error':
            throw new Error(String(event.message || 'Unknown stream error'));
        }
      }
    }

    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
      subagentRuns = d.runs || [];
    } catch {}

    if (getSubagentStreamingState(agentId) === streamState) {
      streamState.fallbackTimer = setTimeout(async () => {
        if (getSubagentStreamingState(agentId) !== streamState) return;
        const reconciled = await reconcileSubagentChatFromServer(agentId, streamState, startTs);
        if (reconciled || getSubagentStreamingState(agentId) !== streamState) return;
        const fallbackContent = String(streamState.finalReply || streamState.content || '').trim()
          || 'No final response was returned. The run may have been interrupted before completion.';
        if (commitSubagentStreamingReply(agentId, streamState, fallbackContent, startTs, { streamFallback: true })) {
          scheduleNextSubagentQueuedMessage(agentId);
        }
        requestAnimationFrame(() => {
          const newInp = document.getElementById('subagent-chat-input');
          if (newInp) newInp.focus();
        });
      }, 450);
    }
  } catch (err) {
    wasAborted = controller.signal.aborted || err?.name === 'AbortError';
    const errorMessage = err?.message || String(err);
    if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
    if (wasAborted) {
      streamState.completed = true;
      pushSubagentProgressLine('Stopped by user.', streamState);
      commitSubagentStreamingReply(
        agentId,
        streamState,
        String(streamState.finalReply || streamState.content || '').trim() || 'Stopped.',
        startTs,
        { source: 'subagent_chat', success: false, stopped: true },
      );
    } else {
      if (getSubagentStreamingState(agentId) === streamState) setSubagentStreamingState(agentId, null);
      subagentChatHistory.push({ id: `error_${Date.now()}`, agentId, role: 'agent', content: `Error: ${errorMessage}`, ts: Date.now(), metadata: { source: 'subagent_chat', success: false } });
    }
  } finally {
    if (subagentChatAbortControllers[agentId] === controller) delete subagentChatAbortControllers[agentId];
  }

  if (!getSubagentStreamingState(agentId) && activeSubagentId === agentId) renderSubagentBoard(agentId);
  if (!wasAborted) scheduleNextSubagentQueuedMessage(agentId);
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const newInp = document.getElementById('subagent-chat-input');
    if (newInp) {
      newInp.focus();
      newInp.oninput = () => {
        subagentChatDraft = newInp.value;
        resizeSubagentChatInput();
        refreshSubagentChatComposerState(agentId);
      };
      resizeSubagentChatInput();
    }
  });
}

function abortSubagentChat(agentId) {
  const controller = subagentChatAbortControllers[agentId];
  if (controller && !controller.signal.aborted) controller.abort();
  const streamState = getSubagentStreamingState(agentId);
  if (streamState) {
    streamState.abortRequested = true;
    pushSubagentProgressLine('Stopping...', streamState);
    refreshSubagentStreamingUI(agentId, true);
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function saveSubagentSystemPrompt(agentId) {
  const editor = document.getElementById('subagent-system-prompt-editor');
  if (!editor) return;
  const content = editor.value;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    subagentSystemPrompt = content;
    showToast('Saved', 'System prompt saved', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save: ' + err.message, 'error');
  }
}

// ── Context Reference Actions ─────────────────────────────────────────────────
async function saveSubagentCtxRef(agentId) {
  const titleEl = document.getElementById(`sa-ctx-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-content-${agentId}`);
  const title = titleEl?.value.trim();
  const content = contentEl?.value.trim();
  if (!title || !content) { showToast('Error', 'Title and content are required', 'error'); return; }
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`, {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    });
    subagentContextRefs = [...subagentContextRefs, d.ref];
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function saveSubagentSkillIds(agentId, skillIds) {
  const nextIds = Array.from(new Set((Array.isArray(skillIds) ? skillIds : []).map(id => String(id || '').trim()).filter(Boolean)));
  const current = subagentsData.find(a => a.id === agentId);
  if (!current) return;
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ skillIds: nextIds }),
    });
    const updated = d.agent || { ...current, skillIds: nextIds };
    const idx = subagentsData.findIndex(a => a.id === agentId);
    if (idx >= 0) subagentsData[idx] = { ...subagentsData[idx], ...updated };
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function addSubagentSkill(agentId) {
  const select = document.getElementById(`sa-skill-select-${agentId}`);
  const skillId = String(select?.value || '').trim();
  if (!skillId) return;
  const agent = subagentsData.find(a => a.id === agentId);
  const current = Array.isArray(agent?.skillIds) ? agent.skillIds : [];
  await saveSubagentSkillIds(agentId, [...current, skillId]);
  showToast('Saved', 'Skill attached to subagent', 'success');
}

async function removeSubagentSkill(agentId, skillId) {
  const agent = subagentsData.find(a => a.id === agentId);
  const current = Array.isArray(agent?.skillIds) ? agent.skillIds : [];
  await saveSubagentSkillIds(agentId, current.filter(id => id !== skillId));
  showToast('Saved', 'Skill removed from subagent', 'success');
}

async function reloadSubagentSkills(agentId) {
  try {
    const data = await api('/api/skills?refresh=1');
    subagentSkillsCache = Array.isArray(data.skills) ? data.skills : [];
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function openSubagentCtxRefModal(agentId, refId) {
  _subagentCtxRefEditId = refId;
  const ref = subagentContextRefs.find(r => r.id === refId);
  if (!ref) return;
  const modal = document.getElementById(`sa-ctx-modal-${agentId}`);
  const titleEl = document.getElementById(`sa-ctx-modal-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-modal-content-${agentId}`);
  if (!modal || !titleEl || !contentEl) return;
  titleEl.value = ref.title || '';
  contentEl.value = ref.content || '';
  modal.style.display = 'flex';
}

function closeSubagentCtxRefModal(agentId) {
  const modal = document.getElementById(`sa-ctx-modal-${agentId}`);
  if (modal) modal.style.display = 'none';
  _subagentCtxRefEditId = null;
}

async function updateSubagentCtxRef(agentId) {
  if (!_subagentCtxRefEditId) return;
  const titleEl = document.getElementById(`sa-ctx-modal-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-modal-content-${agentId}`);
  const title = titleEl?.value.trim();
  const content = contentEl?.value.trim();
  if (!title || !content) { showToast('Error', 'Title and content are required', 'error'); return; }
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs/${encodeURIComponent(_subagentCtxRefEditId)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    });
    subagentContextRefs = subagentContextRefs.map(r => r.id === _subagentCtxRefEditId ? d.ref : r);
    closeSubagentCtxRefModal(agentId);
    renderSubagentBoard(agentId);
    showToast('Saved', 'Context reference updated', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function deleteSubagentCtxRef(agentId) {
  if (!_subagentCtxRefEditId) return;
  if (!confirm('Delete this context reference?')) return;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs/${encodeURIComponent(_subagentCtxRefEditId)}`, { method: 'DELETE' });
    subagentContextRefs = subagentContextRefs.filter(r => r.id !== _subagentCtxRefEditId);
    closeSubagentCtxRefModal(agentId);
    renderSubagentBoard(agentId);
    showToast('Deleted', 'Context reference removed', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function uploadSubagentContextFile(agentId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const isText = file.type.startsWith('text/') || /\.(md|txt|json|yaml|yml|csv|xml|js|ts|py|sh|html|css)$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      let content, encoding;
      if (isText) {
        content = e.target.result;
        encoding = 'text';
      } else {
        content = e.target.result.split(',')[1]; // strip data:...;base64,
        encoding = 'base64';
      }
      bgtToast('📎 Uploading…', file.name);
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-files`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, encoding, title: file.name }),
      });
      subagentContextRefs = [...subagentContextRefs, d.ref];
      renderSubagentBoard(agentId);
      showToast('Uploaded', `${file.name} added as context reference`, 'success');
    } catch (err) {
      showToast('Error', err.message, 'error');
    }
  };
  if (isText) reader.readAsText(file);
  else reader.readAsDataURL(file);
  input.value = '';
}

// ── Memory Tab Actions ────────────────────────────────────────────────────────
async function reloadSubagentMemory(agentId) {
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`);
    subagentMemoryNotes = d.notes || '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ── Heartbeat Tab Actions ─────────────────────────────────────────────────────
async function saveSubagentHbConfig(agentId) {
  const enabledEl = document.getElementById(`sa-hb-enabled-${agentId}`);
  const intervalEl = document.getElementById(`sa-hb-interval-${agentId}`);
  const enabled = enabledEl?.checked === true;
  const interval_minutes = Math.max(1, Math.min(1440, Number(intervalEl?.value) || 30));
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, interval_minutes }),
    });
    subagentHbConfig = { enabled, intervalMinutes: interval_minutes };
    if (statusEl) { statusEl.textContent = 'Config saved.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function saveSubagentHbMd(agentId) {
  const textarea = document.getElementById(`sa-hb-md-${agentId}`);
  if (!textarea) return;
  const content = textarea.value;
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    subagentHbMd = content;
    if (statusEl) { statusEl.textContent = 'HEARTBEAT.md saved.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function reloadSubagentHb(agentId) {
  subagentHbMd = '';
  try {
    const [cfgD, mdD] = await Promise.all([
      api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
      api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
    ]);
    const cfg = cfgD?.config || {};
    subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
    subagentHbMd = mdD?.content || '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function tickSubagentHbFromDetail(agentId) {
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
    if (statusEl) { statusEl.textContent = 'Heartbeat triggered.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed: ${err.message}`;
  }
}

async function spawnSubagentTask(agentId) {
  const task = prompt('Enter task for agent:');
  if (!task) return;
  try {
    bgtToast('▶ Running...', `Spawning ${agentId}`);
    const result = await api(`/api/agents/${encodeURIComponent(agentId)}/spawn`, {
      method: 'POST',
      body: JSON.stringify({ task, timeoutMs: 120000 }),
    });
    if (result.success) {
      const preview = result.result?.result?.slice(0, 200) || '';
      bgtToast('✅ Done', preview || 'Task completed');
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`).catch(() => null);
      subagentRuns = d?.runs || [];
      renderSubagentBoard(agentId);
    } else {
      bgtToast('❌ Failed', result.error || 'Unknown error');
    }
  } catch (err) {
    bgtToast('❌ Error', err.message);
  }
}

async function refreshSubagentDetail(agentId) {
  subagentSystemPrompt = '';
  subagentHbMd = '';
  await loadSubagentBoardData(agentId);
  // Reload current tab data too
  if (subagentDetailTab === 'systemprompt') {
    try { const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`); subagentSystemPrompt = d.content || ''; } catch {}
  }
  if (subagentDetailTab === 'memory') {
    try { const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`); subagentMemoryNotes = d.notes || ''; } catch {}
  }
  if (subagentDetailTab === 'heartbeat') {
    try {
      const [cfgD, mdD] = await Promise.all([
        api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
        api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
      ]);
      const cfg = cfgD?.config || {};
      subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
      subagentHbMd = mdD?.content || '';
    } catch {}
  }
  renderSubagentBoard(agentId);
}

function openSubagentSettings(agentId) {
  // Open settings page at agents tab, pre-selecting the agent
  if (typeof window.openSettings === 'function') window.openSettings();
  setTimeout(() => {
    if (typeof window.setSettingsTab === 'function') window.setSettingsTab('agents');
    setTimeout(() => {
      const item = document.querySelector(`[data-agent-id-settings="${agentId}"]`);
      if (item) item.click();
    }, 200);
  }, 150);
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startSubagentPolling(agentId) {
  stopSubagentPolling();
  _subagentDetailPolling = setInterval(async () => {
    if (!activeSubagentId) return stopSubagentPolling();
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
      const fresh = d.runs || [];
	      if (fresh.length !== subagentRuns.length) {
	        subagentRuns = fresh;
	        if (subagentDetailTab === 'runs') renderSubagentBoard(agentId);
	      }
	      if (subagentDetailTab === 'chat') {
	        const chat = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
	        const freshChat = normalizeSubagentChatMessages(chat.messages || []);
	        if (freshChat.length !== subagentChatHistory.length) {
	          subagentChatHistory = preserveSubagentProcessMetadata(freshChat);
	          renderSubagentBoard(agentId);
	        }
	      }
	    } catch {}
	  }, 15000);
	}

async function previewAgentProfilePackImport() {
  const input = document.getElementById('agent-pack-import-path');
  agentPackImportPath = String(input?.value || agentPackImportPath || '').trim();
  if (!agentPackImportPath) return showToast?.('Enter a local pack path');
  agentPackImportBusy = true;
  renderSubagentsCanvas();
  try {
    const data = await api('/api/agent-profile-packs/preview', {
      method: 'POST',
      body: JSON.stringify({ path: agentPackImportPath }),
      timeoutMs: 12000,
    });
    if (!data?.success) throw new Error(data?.error || 'Preview failed');
    agentPackImportPreview = data.preview;
    showToast?.('Profile pack preview ready');
  } catch (err) {
    showToast?.(`Profile pack preview failed: ${err.message || err}`);
  } finally {
    agentPackImportBusy = false;
    renderSubagentsCanvas();
  }
}

async function installAgentProfilePackImport() {
  const input = document.getElementById('agent-pack-import-path');
  agentPackImportPath = String(input?.value || agentPackImportPath || '').trim();
  if (!agentPackImportPath) return showToast?.('Enter a local pack path');
  agentPackImportBusy = true;
  renderSubagentsCanvas();
  try {
    const data = await api('/api/agent-profile-packs/install', {
      method: 'POST',
      body: JSON.stringify({ path: agentPackImportPath, overwrite: true }),
      timeoutMs: 20000,
    });
    if (!data?.success) throw new Error(data?.error || 'Install failed');
    agentPackImportPreview = data.preview;
    showToast?.(`Installed ${data.agent?.name || data.agent?.id || 'profile pack'}`);
    await refreshSubagents();
    if (data.agent?.id) await openSubagentDetail(data.agent.id);
  } catch (err) {
    showToast?.(`Profile pack install failed: ${err.message || err}`);
    renderSubagentsCanvas();
  } finally {
    agentPackImportBusy = false;
  }
}

async function uninstallAgentProfilePack(agentId) {
  if (!agentId) return;
  try {
    const data = await api(`/api/agent-profile-packs/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
      timeoutMs: 12000,
    });
    if (!data?.success) throw new Error(data?.error || 'Uninstall failed');
    showToast?.(`Uninstalled ${agentId}`);
    activeSubagentId = null;
    await refreshSubagents();
  } catch (err) {
    showToast?.(`Profile pack uninstall failed: ${err.message || err}`);
  }
}


function stopSubagentPolling() {
  if (_subagentDetailPolling) { clearInterval(_subagentDetailPolling); _subagentDetailPolling = null; }
}

// ── Page lifecycle ────────────────────────────────────────────────────────────
function subagentsPageActivate() {
  stopSubagentPolling();
  activeSubagentId = null;

  // Reset canvas to full width (in case detail panel was open)
  const canvasWrap = document.getElementById('subagents-canvas-wrap');
  if (canvasWrap) {
    canvasWrap.style.transition = 'none';
    canvasWrap.style.width = '100%';
  }

  // Hide detail board
  const board = document.getElementById('subagent-board');
  if (board) {
    board.style.display = 'none';
    board.style.opacity = '0';
    board.style.width = '0';
  }

  // Restore any dimmed cards
  document.querySelectorAll('.subagent-card').forEach(el => {
    el.style.opacity = '1';
    el.style.pointerEvents = '';
  });

  refreshSubagents();
}

async function openScheduleOwnerAgent(agentId) {
  if (!agentId) return;
  if (typeof window.setMode === 'function') window.setMode('subagents');
  await refreshSubagents();
  await openSubagentDetail(agentId);
}

function ensureSubagentExternalStream(agentId, meta = {}) {
  let streamState = getSubagentStreamingState(agentId);
  if (streamState && streamState.completed !== true) return streamState;
  streamState = {
    agentId,
    content: '',
    thinking: '',
    processEntries: [],
    progressLines: [meta.scheduleName ? `Scheduled run: ${meta.scheduleName}` : `${getActiveSubagentName(agentId)} is running...`],
    completed: false,
    finalReply: '',
    fallbackTimer: null,
    taskId: meta.taskId || '',
    scheduleId: meta.scheduleId || '',
    externalStream: true,
  };
  setSubagentStreamingState(agentId, streamState);
  if (agentId === activeSubagentId && subagentDetailTab === 'chat') {
    renderSubagentBoard(agentId);
    requestAnimationFrame(() => {
      const msgs = document.getElementById('subagent-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
  }
  return streamState;
}

function applySubagentExternalStreamEvent(agentId, rawEvent, meta = {}) {
  if (!agentId || !rawEvent) return;
  const event = { type: rawEvent.type || meta.event, ...rawEvent };
  const streamState = ensureSubagentExternalStream(agentId, meta);

  switch (event.type) {
    case 'token': {
      const chunk = String(event.text || '');
      if (chunk) {
        if (!streamState.finalResponseStarted && !streamState.toolActivityStarted) {
          appendSubagentLiveTrace(streamState, 'preamble', chunk, { append: true });
        } else {
          streamState.finalResponseStarted = true;
          streamState.content = `${streamState.content || ''}${chunk}`;
        }
      }
      break;
    }
    case 'thinking_delta': {
      const chunk = String(event.thinking || event.text || '');
      if (chunk) {
        streamState.thinking = `${streamState.thinking || ''}${chunk}`;
        if (!streamState.progressLines?.some((line) => /^Thinking/i.test(String(line)))) {
          pushSubagentProgressLine('Thinking...', streamState);
        }
      }
      break;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(event.thinking || event.text || '').trim();
      if (thought) {
        streamState.thinking = streamState.thinking ? `${streamState.thinking}\n\n${thought}` : thought;
        addSubagentProcessEntry('think', thought, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'info': {
      const info = String(event.message || '').trim();
      if (info) {
        pushSubagentProgressLine(info, streamState);
        addSubagentProcessEntry('info', info, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'progress_state': {
      const items = Array.isArray(event.items) ? event.items : [];
      const activeIndex = Number(event.activeIndex || -1);
      const activeText = String(activeIndex >= 0 ? items[activeIndex]?.text || '' : '').trim();
      if (activeText) pushSubagentProgressLine(activeText, streamState);
      break;
    }
    case 'tool_call': {
      const action = String(event.action || '').trim();
      if (action) {
        const stepNum = Number(event.stepNum || 0);
        const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
        const args = (event.args && typeof event.args === 'object') ? event.args : null;
        const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
        moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
        streamState.toolActivityStarted = true;
        pushSubagentProgressLine(`${stepPrefix}Running ${action}...`, streamState);
        addSubagentProcessEntry(
          'tool',
          `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
          (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
          streamState,
        );
      }
      break;
    }
    case 'tool_result': {
      const action = String(event.action || '').trim() || 'tool';
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const text = String(event.result || '').trim();
      const ok = event.error === true ? false : !/^ERROR:/i.test(text);
      moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
      streamState.toolActivityStarted = true;
      pushSubagentProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`, streamState);
      addSubagentProcessEntry(
        ok ? 'result' : 'error',
        `${stepPrefix}${action} => ${text || '(no output)'}`,
        event.actor ? { actor: event.actor } : undefined,
        streamState,
      );
      break;
    }
    case 'tool_progress': {
      const action = String(event.action || '').trim();
      const progressMsg = String(event.message || '').trim();
      if (action && progressMsg) {
        moveSubagentVisibleAnswerIntoWorkflowTrace(streamState);
        streamState.toolActivityStarted = true;
        pushSubagentProgressLine(`${action}: ${progressMsg}`, streamState);
        addSubagentProcessEntry('info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'approval_created': {
      upsertSubagentChatApproval(agentId, event.approval || event);
      break;
    }
    case 'approval_approved':
    case 'approval_denied':
    case 'approval_expired':
    case 'approval_failed': {
      const status = event.type === 'approval_approved' ? 'approved'
        : event.type === 'approval_denied' ? 'rejected'
          : event.type === 'approval_expired' ? 'expired'
            : 'failed';
      updateSubagentChatApprovalStatus(event.approvalId || event.id || event.approval?.id, status, event);
      break;
    }
    case 'final':
    case 'done': {
      const reply = String(event.reply || event.text || '').trim();
      if (reply) {
        streamState.finalReply = reply;
        if (!streamState.content) streamState.content = reply;
        addSubagentProcessEntry('final', reply, undefined, streamState);
      }
      streamState.completed = event.type === 'done';
      break;
    }
    case 'error': {
      const message = String(event.message || 'Scheduled run error').trim();
      pushSubagentProgressLine(message, streamState);
      addSubagentProcessEntry('error', message, undefined, streamState);
      break;
    }
  }

  if (agentId === activeSubagentId) {
    refreshSubagentStreamingUI(agentId, true);
  }
}

async function replaySubagentChatStream(agentId, afterSeq = 0) {
  if (!agentId) return;
  try {
    const data = await api(`/api/agents/${encodeURIComponent(agentId)}/chat/stream?after=${Math.max(0, Number(afterSeq) || 0)}`);
    const frames = Array.isArray(data?.events) ? data.events : [];
    for (const frame of frames) {
      applySubagentExternalStreamEvent(agentId, {
        type: frame.type || frame.event,
        ...(frame.data || {}),
      }, {
        event: frame.type || frame.event,
        streamId: frame.streamId,
        seq: frame.seq,
        retainedReplay: true,
      });
    }
    const streamState = getSubagentStreamingState(agentId);
    if (!data?.active && streamState?.completed === true) {
      setTimeout(async () => {
        if (getSubagentStreamingState(agentId) !== streamState || streamState.completed !== true) return;
        const reconciled = await reconcileSubagentChatFromServer(agentId, streamState, 0);
        if (!reconciled && getSubagentStreamingState(agentId) === streamState) {
          setSubagentStreamingState(agentId, null);
          if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
        }
      }, 900);
    }
  } catch {}
}

// ── Module init ───────────────────────────────────────────────────────────────
console.log('[SubagentsPage] module loaded');

// ── WS events ─────────────────────────────────────────────────────────────────
wsEventBus.on('agent_run_complete', (data) => {
  if (!activeSubagentId || data.agentId !== activeSubagentId) return;
  refreshSubagentDetail(activeSubagentId);
});

wsEventBus.on('ws:open', () => {
  if (activeSubagentId && subagentDetailTab === 'chat') {
    replaySubagentChatStream(activeSubagentId).catch(() => {});
  }
});

window.previewAgentProfilePackImport = previewAgentProfilePackImport;
window.installAgentProfilePackImport = installAgentProfilePackImport;
window.uninstallAgentProfilePack = uninstallAgentProfilePack;

wsEventBus.on('subagent_chat_message', (data) => {
  if (!data.agentId || !data.message) return;
  let [message] = normalizeSubagentChatMessages([data.message]);
  if (!message) return;
  const streamState = getSubagentStreamingState(data.agentId);
  if (streamState && message.role === 'agent') {
    if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
    message = mergeStreamingStateIntoMessage(message);
    setSubagentStreamingState(data.agentId, null);
  }
  if (message.role === 'agent' && subagentDesktopVoiceTargetAgentId === data.agentId && String(message.content || '').trim()) {
    speakSubagentVoiceReply(message.content);
    subagentDesktopVoiceTargetAgentId = '';
  }
  if (data.agentId !== activeSubagentId) {
    return;
  }
  const priorChatHistory = subagentChatHistory;
  [message] = preserveSubagentProcessMetadata([message], priorChatHistory);
  subagentChatHistory = priorChatHistory.filter(m => !(
    ((m.metadata?.pending || m.metadata?.localStreamingFallback) && m.role === message.role && m.content === message.content)
  ));
  if (!subagentChatHistory.some(m => m.id === message.id)) {
    subagentChatHistory.push(message);
    subagentChatHistory = dedupeSubagentChatMessages(subagentChatHistory);
  }
  if (subagentDetailTab === 'chat') {
    renderSubagentBoard(activeSubagentId);
    requestAnimationFrame(() => {
      const msgs = document.getElementById('subagent-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
  }
});

wsEventBus.on('subagent_chat_stream_event', (data) => {
  const agentId = String(data.agentId || '').trim();
  if (!agentId) return;
  const streamState = getSubagentStreamingState(agentId);
  if (streamState?.source === 'localSse') return;
  if (!streamState && ['final', 'done'].includes(String(data.event || ''))) return;
  applySubagentExternalStreamEvent(agentId, {
    type: data.event,
    ...(data.data || {}),
  }, {
    event: data.event,
    taskId: data.taskId,
    scheduleId: data.scheduleId,
    scheduleName: data.scheduleName,
  });
});

wsEventBus.on('subagent_run_updated', async (data = {}) => {
  const agentId = String(data.agentId || '').trim();
  if (!agentId || agentId !== activeSubagentId) return;
  try {
    const runsData = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
    subagentRuns = runsData.runs || [];
    const taskId = String(data.taskId || '').trim();
    if (taskId && subagentRunDetails[taskId]?.task) {
      const detail = await api(`/api/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(taskId)}`).catch(() => null);
      if (detail?.task) subagentRunDetails[taskId] = { task: detail.task, run: detail.run || null, evidenceBus: detail.evidenceBus || null };
    }
    if (subagentDetailTab === 'runs') renderSubagentBoard(agentId);
  } catch {}
});

wsEventBus.on('approval_created', (msg = {}) => {
  if (activeSubagentId) upsertSubagentChatApproval(activeSubagentId, msg.approval || msg);
});

['approval_approved', 'approval_denied', 'approval_expired', 'approval_failed'].forEach((eventName) => {
  wsEventBus.on(eventName, (msg = {}) => {
    const status = eventName === 'approval_approved' ? 'approved'
      : eventName === 'approval_denied' ? 'rejected'
        : eventName === 'approval_expired' ? 'expired'
          : 'failed';
    updateSubagentChatApprovalStatus(msg.approvalId || msg.id || msg.approval?.id, status, msg);
  });
});

wsEventBus.on('agents_updated', () => { refreshSubagents(); });

// ── Exports ───────────────────────────────────────────────────────────────────
window.subagentsPageActivate = subagentsPageActivate;
window.refreshSubagents = refreshSubagents;
window.openSubagentDetail = openSubagentDetail;
window.openScheduleOwnerAgent = openScheduleOwnerAgent;
window.closeSubagentDetail = closeSubagentDetail;
window.switchSubagentTab = switchSubagentTab;
window.sendSubagentChat = sendSubagentChat;
window.abortSubagentChat = abortSubagentChat;
window.startSubagentDesktopVoice = startSubagentDesktopVoice;
window.resolveSubagentInlineApproval = resolveSubagentInlineApproval;
window.openSubagentChatFilePicker = openSubagentChatFilePicker;
window.onSubagentChatFilesChosen = onSubagentChatFilesChosen;
window.removeSubagentChatFile = removeSubagentChatFile;
window.handleSubagentChatPaste = handleSubagentChatPaste;
window.openSubagentChatAttachmentPreview = openSubagentChatAttachmentPreview;
window.closeSubagentPanelAttachmentPreview = closeSubagentPanelAttachmentPreview;
window.saveSubagentSystemPrompt = saveSubagentSystemPrompt;
window.spawnSubagentTask = spawnSubagentTask;
window.refreshSubagentDetail = refreshSubagentDetail;
window.openSubagentSettings = openSubagentSettings;
window.reloadSubagentRuns = reloadSubagentRuns;
window.openSubagentRunDetail = openSubagentRunDetail;
window.sendSubagentRunRecovery = sendSubagentRunRecovery;
// Context refs
window.saveSubagentCtxRef = saveSubagentCtxRef;
window.addSubagentSkill = addSubagentSkill;
window.removeSubagentSkill = removeSubagentSkill;
window.reloadSubagentSkills = reloadSubagentSkills;
window.openSubagentCtxRefModal = openSubagentCtxRefModal;
window.closeSubagentCtxRefModal = closeSubagentCtxRefModal;
window.updateSubagentCtxRef = updateSubagentCtxRef;
window.deleteSubagentCtxRef = deleteSubagentCtxRef;
window.uploadSubagentContextFile = uploadSubagentContextFile;
window.toggleSubagentProcess = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none';
};
window.toggleSubagentTraceDrawer = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const shouldOpen = !el.classList.contains('open');
  el.classList.toggle('open', shouldOpen);
  const btn = Array.from(document.querySelectorAll('.assistant-work-timer--expandable'))
    .find((candidate) => candidate.getAttribute('aria-controls') === id);
  if (btn) {
    btn.classList.toggle('expanded', shouldOpen);
    btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }
};
// Memory
window.reloadSubagentMemory = reloadSubagentMemory;
// Heartbeat
window.saveSubagentHbConfig = saveSubagentHbConfig;
window.saveSubagentHbMd = saveSubagentHbMd;
window.reloadSubagentHb = reloadSubagentHb;
window.tickSubagentHbFromDetail = tickSubagentHbFromDetail;
