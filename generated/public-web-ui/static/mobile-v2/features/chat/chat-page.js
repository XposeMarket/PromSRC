import { renderMd } from '../../../utils.js';
import { ensureMobileV2Markdown } from '../../core/markdown.js';
import { ICONS } from '../../ui/icons.js';
import {
  attachChatInteractionHandlers,
  ensureChatInteractionStyles,
  questionDraftStorageKey,
  renderChatInteractions,
} from './chat-interactions.js';
import {
  attachChatArtifactHandlers,
  renderSpecialChatArtifact,
} from './chat-artifacts.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function renderPlainText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function renderAssistantText(text) {
  try { return renderMd(String(text || '')); }
  catch { return renderPlainText(text); }
}

function messageText(message) {
  return String(message?.text || message?.body?.text || (typeof message?.content === 'string' ? message.content : '') || '');
}

function messageMedia(message, gateway, { attachmentsOnly = false } = {}) {
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  const records = [
    ...(Array.isArray(message?.attachmentPreviews) ? message.attachmentPreviews : []),
    ...(Array.isArray(message?.attachments) ? message.attachments : []),
    ...(Array.isArray(body.attachments) ? body.attachments : []),
    ...(!attachmentsOnly && Array.isArray(message?.files) ? message.files : []),
    ...(!attachmentsOnly && Array.isArray(body.files) ? body.files : []),
    ...(!attachmentsOnly && Array.isArray(message?.generatedImages) ? message.generatedImages.map((item) => ({ ...item, kind: 'image', generated: true })) : []),
    ...(!attachmentsOnly && Array.isArray(message?.generated_images) ? message.generated_images.map((item) => ({ ...item, kind: 'image', generated: true })) : []),
    ...(!attachmentsOnly && Array.isArray(message?.generatedVideos) ? message.generatedVideos.map((item) => ({ ...item, kind: 'video', generated: true })) : []),
    ...(!attachmentsOnly && Array.isArray(message?.generated_videos) ? message.generated_videos.map((item) => ({ ...item, kind: 'video', generated: true })) : []),
    ...(!attachmentsOnly && body.image && typeof body.image === 'object' ? [{ ...body.image, kind: 'image', generated: true }] : []),
    ...(!attachmentsOnly && message?.image && typeof message.image === 'object' ? [{ ...message.image, kind: 'image', generated: true }] : []),
  ];
  const seen = new Set();
  const cards = records.map((item = {}) => {
    const name = String(item.name || item.file_name || item.fileName || item.filename || item.path || 'Attachment').trim();
    const path = String(item.path || item.workspacePath || item.filePath || '').trim();
    const dataUrl = String(item.dataUrl || '').trim();
    const base64 = String(item.base64 || '').trim();
    const mime = String(item.mimeType || item.mime_type || item.type || (item.kind === 'video' ? 'video/mp4' : item.kind === 'image' ? 'image/png' : 'application/octet-stream'));
    const kind = String(mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : item.kind || 'file').toLowerCase();
    const key = path || dataUrl || `${name}:${mime}`;
    if (!name || seen.has(key)) return '';
    seen.add(key);
    let src = dataUrl;
    if (!src && base64 && /^(image|video|audio)\//i.test(mime)) src = `data:${mime};base64,${base64}`;
    if (!src && path && typeof gateway?.inlineMediaUrl === 'function') src = gateway.inlineMediaUrl(path);
    const meta = [mime.startsWith('image/') ? 'Image' : mime.startsWith('video/') ? 'Video' : mime.split('/').pop()?.toUpperCase(), item.bytes || item.size ? `${Math.max(1, Math.round(Number(item.bytes || item.size) / 1024))} KB` : ''].filter(Boolean).join(' · ');
    if (kind === 'image' && src) return `<figure class="pm-v2-media-card"><a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy"></a><figcaption><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></figcaption></figure>`;
    if (kind === 'video' && src) return `<figure class="pm-v2-media-card"><video src="${escapeHtml(src)}" controls playsinline preload="metadata"></video><figcaption><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></figcaption></figure>`;
    if (kind === 'audio' && src) return `<figure class="pm-v2-media-card"><audio src="${escapeHtml(src)}" controls preload="metadata"></audio><figcaption><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></figcaption></figure>`;
    const open = path && src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">Open file</a>` : '';
    return `<div class="pm-v2-file-card"><span class="pm-v2-file-icon" aria-hidden="true">${ICONS.doc || '▤'}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></span>${open}</div>`;
  }).filter(Boolean);
  return cards.length ? `<div class="pm-v2-media-gallery${attachmentsOnly ? ' is-attachments' : ''}">${cards.join('')}</div>` : '';
}

function renderTrace(message) {
  const tools = Array.isArray(message?.tools) ? message.tools : [];
  const entries = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  const statusText = String(message?.statusText || '').trim();
  if (!tools.length && !entries.length && !statusText) return '';
  const streaming = message.status === 'streaming';
  const rows = tools.map((tool) => {
    const detail = String(tool.message || tool.summary || (tool.phase === 'tool_result' ? 'Completed' : 'Working…'));
    let payload = tool.raw ? (() => { try { return JSON.stringify(tool.raw.result || tool.raw.extra || tool.raw, null, 2); } catch { return ''; } })() : '';
    if (payload.length > 1800) payload = `${payload.slice(0, 1800)}\n…`;
    return `<details class="pm-v2-tool"><summary><span><strong>${escapeHtml(tool.name || 'Tool')}</strong><small>${escapeHtml(detail)}</small></span><em>${escapeHtml(String(tool.phase || '').replace(/^tool_/, '').replace(/_/g, ' '))}</em></summary>${payload ? `<pre>${escapeHtml(payload)}</pre>` : ''}</details>`;
  }).join('');
  const summary = String(tools.at(-1)?.message || tools.at(-1)?.name || statusText || 'Activity');
  const thought = String(message.reasoning || '').trim();
  const detail = thought ? `<details class="pm-v2-trace-thought"><summary>Thought summary</summary><div class="markdown-body">${renderAssistantText(thought)}</div></details>` : '';
  return `<section class="pm-v2-trace-dock${streaming ? ' is-live' : ''}" aria-label="Assistant activity"><details${streaming ? ' open' : ''}><summary><span class="pm-v2-trace-indicator" aria-hidden="true"></span><strong>${escapeHtml(streaming ? summary : `${tools.length} tool ${tools.length === 1 ? 'step' : 'steps'}`)}</strong><em>${tools.length ? `${tools.length}` : ''}</em></summary><div class="pm-v2-trace-body">${rows || `<span class="pm-v2-typing">${escapeHtml(statusText || 'Working…')}</span>`}${detail}</div></details></section>`;
}

function renderArtifacts(message, gateway, weatherSelections) {
  const richArtifacts = Array.isArray(message?.richArtifacts) ? message.richArtifacts : [];
  const artifacts = richArtifacts.length ? [...richArtifacts] : (Array.isArray(message?.artifacts) ? [...message.artifacts] : []);
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  if (message?.productCarousel && Array.isArray(message.productCarousel.items)) artifacts.push({ type: 'products', ...message.productCarousel });
  else if (body.productCarousel && Array.isArray(body.productCarousel.items)) artifacts.push({ type: 'products', ...body.productCarousel });
  if (!artifacts.length) return '';
  return `<div class="pm-v2-artifacts">${artifacts.map((artifact, index) => {
    const specialized = renderSpecialChatArtifact(artifact, message, index, gateway, { weatherSelections });
    if (specialized !== null) return specialized;
    const type = String(artifact?.type || artifact?.kind || 'artifact').replace(/_/g, ' ');
    const title = String(artifact?.title || artifact?.name || type.replace(/\b\w/g, (letter) => letter.toUpperCase()));
    const summary = String(artifact?.summary || artifact?.description || artifact?.text || (typeof artifact?.content === 'string' ? artifact.content : '') || '');
    const items = Array.isArray(artifact?.items) ? artifact.items : [];
    if (artifact?.type === 'thread_links') return items.map((item) => `<button type="button" class="pm-v2-thread-link" data-v2-thread="${escapeHtml(item.sessionId || '')}" data-v2-thread-gateway="${escapeHtml(item.gatewayId || message.gatewayId || '')}"><strong>${escapeHtml(item.title || item.label || 'Open chat')}</strong><small>${escapeHtml(item.subtitle || item.status || '')}</small><span>Open chat ›</span></button>`).join('');
    const rows = items.slice(0, 6).map((item) => {
      if (typeof item === 'string') return `<li>${escapeHtml(item)}</li>`;
      const label = item?.title || item?.name || item?.label || item?.symbol || item?.path || '';
      const value = item?.summary || item?.description || item?.value || item?.status || '';
      return label || value ? `<li><strong>${escapeHtml(label)}</strong>${value ? `<span>${escapeHtml(value)}</span>` : ''}</li>` : '';
    }).join('');
    const href = safeExternalUrl(artifact?.url || artifact?.href || artifact?.sourceUrl || '');
    const media = artifact?.image || artifact?.imageUrl || artifact?.thumbnailUrl;
    const imageUrl = safeExternalUrl(typeof media === 'string' ? media : media?.url || '');
    return `<article class="pm-v2-artifact-card"><div class="pm-v2-artifact-kicker">${escapeHtml(type)}</div><strong>${escapeHtml(title)}</strong>${summary ? `<div class="pm-v2-artifact-copy">${renderAssistantText(summary)}</div>` : ''}${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" loading="lazy">` : ''}${rows ? `<ul>${rows}</ul>` : ''}${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(title)} ↗</a>` : ''}</article>`;
  }).join('')}</div>`;
}

function safeExternalUrl(value) {
  try { const url = new URL(String(value || ''), window.location.href); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function renderGoalAndWork(message) {
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  const goal = message?.goalCompletionReport || message?.goal_completion_report || body.goalCompletionReport;
  const goalCard = goal && typeof goal === 'object'
    ? `<div class="pm-v2-goal-report"><span>Goal complete</span><strong>${escapeHtml(Number(goal.totalTokens || 0).toLocaleString())} tokens</strong>${Number(goal.totalCostMicros) > 0 ? `<small>$${(Number(goal.totalCostMicros) / 1_000_000).toFixed(4)} estimated</small>` : ''}</div>`
    : '';
  const workgroup = message?.voiceWorkgroup || message?.voice_workgroup || body.voiceWorkgroup;
  const workers = Array.isArray(workgroup?.workers) ? workgroup.workers : [];
  const workCards = workers.length ? `<section class="pm-v2-workgroup" aria-label="Voice workgroup"><header><strong>${workers.length} worker${workers.length === 1 ? '' : 's'}</strong><small>${workers.filter((worker) => /complete|done|succeeded/i.test(String(worker.status || ''))).length}/${workers.length} complete</small></header><div>${workers.map((worker, index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(worker.title || worker.agentName || `Worker ${index + 1}`)}</strong><small>${escapeHtml(String(worker.status || 'queued').replace(/_/g, ' '))}</small>${worker.summary || worker.result ? `<p>${escapeHtml(worker.summary || worker.result)}</p>` : ''}</article>`).join('')}</div></section>` : '';
  const backgroundWork = message?.backgroundWork || body.backgroundWork;
  const bg = Array.isArray(message?.backgroundAgents) ? message.backgroundAgents : (Array.isArray(backgroundWork) ? backgroundWork : (backgroundWork ? [backgroundWork] : []));
  const backgroundCards = bg.length ? `<section class="pm-v2-background-dock"><strong>Background work</strong>${bg.map((item) => `<article><span>${escapeHtml(item.agentName || item.title || item.name || 'Background agent')}</span><small>${escapeHtml(String(item.status || 'running').replace(/_/g, ' '))}</small>${item.summary || item.result || item.error ? `<p>${escapeHtml(item.summary || item.result || item.error)}</p>` : ''}</article>`).join('')}</section>` : '';
  const fileChanges = message?.fileChanges || message?.file_changes || body.fileChanges;
  const changedFiles = Array.isArray(fileChanges) ? fileChanges : Array.isArray(fileChanges?.files) ? fileChanges.files : [];
  const changesCard = changedFiles.length ? `<section class="pm-v2-file-changes"><strong>Files changed · ${changedFiles.length}</strong><ul>${changedFiles.slice(0, 8).map((file) => `<li><span>${escapeHtml(file.status || file.action || 'changed')}</span>${escapeHtml(file.path || file.name || 'Workspace file')}</li>`).join('')}</ul></section>` : '';
  return `${goalCard}${workCards}${backgroundCards}${changesCard}`;
}

function renderStructuredBody(message) {
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  const summary = Array.isArray(body.summary) ? body.summary : [];
  const numbered = Array.isArray(body.numbered) ? body.numbered : [];
  const teamRows = Array.isArray(body.teamRows) ? body.teamRows : [];
  const summaryHtml = summary.length ? `<ul class="pm-v2-summary-list">${summary.map((item) => `<li><strong>${escapeHtml(item.title || '')}</strong><span>${escapeHtml(item.subtitle || '')}</span></li>`).join('')}</ul>` : '';
  const numberedHtml = numbered.length ? `<ol class="pm-v2-numbered-list">${numbered.map((item, index) => `<li><i>${index + 1}</i><span><strong>${escapeHtml(item.title || '')}</strong><small>${escapeHtml(item.subtitle || '')}</small></span></li>`).join('')}</ol>` : '';
  const teamsHtml = teamRows.length ? `<ul class="pm-v2-team-rows">${teamRows.map((item) => `<li><strong>${escapeHtml(item.name || '')}</strong><span>${escapeHtml(item.detail || '')}</span></li>`).join('')}</ul>` : '';
  return `${summaryHtml}${numberedHtml}${teamsHtml}`;
}

function messageActions(message, index) {
  if (message.role === 'user' || message.status === 'streaming') return '';
  return `<div class="pm-msg-actions pm-v2-message-actions"><button type="button" class="pm-msg-action" data-v2-message-action="copy" data-message-index="${index}" aria-label="Copy response" title="Copy">${ICONS.clipboard || '⧉'}</button><button type="button" class="pm-msg-action" data-v2-message-action="speak" data-message-index="${index}" aria-label="Speak response" title="Speak">${ICONS.volume || ICONS.play || '◖'}</button><button type="button" class="pm-msg-action" data-v2-message-action="fork" data-message-index="${index}" aria-label="Fork conversation" title="Fork">${ICONS.fork || '⑂'}</button></div>`;
}

function messageMarkup(message, index, gateway, shell, weatherSelections) {
  const user = message.role === 'user';
  const text = messageText(message);
  const attachments = user ? messageMedia(message, gateway, { attachmentsOnly: true }) : '';
  const attachmentOnlyPrompt = !!attachments && /^(attached file\(s\)|please review the attached file\(s\)\.?|please inspect the attached file\(s\)\.)$/i.test(text.trim());
  const body = text && !attachmentOnlyPrompt ? (user ? renderPlainText(text) : renderAssistantText(text)) : '';
  const media = !user ? messageMedia(message, gateway) : '';
  const trace = !user ? renderTrace(message) : '';
  const interactions = !user ? renderChatInteractions(message) : '';
  const artifacts = !user ? renderArtifacts(message, gateway, weatherSelections) : '';
  const structured = !user ? renderStructuredBody(message) : '';
  const work = !user ? renderGoalAndWork(message) : '';
  const status = message.status === 'streaming' && !text ? '<span class="pm-v2-typing">Thinking…</span>' : '';
  const error = message.status === 'error' ? `<div class="pm-v2-message-error">${escapeHtml(message.error || 'Response interrupted')}</div>` : '';
  const workflowLabel = message.workflowLabel || message.workflowTransitionLabel || '';
  const id = String(message.id || message.messageId || `message-${index}`);
  const content = `${workflowLabel ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}${attachments}<div class="pm-bubble"><div class="markdown-body">${body || status}</div>${structured}${interactions}${trace}${artifacts}${media}${work}${error}</div>${!user && message.status !== 'streaming' ? messageActions(message, index) : ''}`;
  return `<div class="pm-msg ${user ? 'from-user' : 'from-ai'}${message.workflowPart ? ` workflow-${escapeHtml(message.workflowPart)}` : ''}" data-message-id="${escapeHtml(id)}" data-message-index="${index}"${message.status === 'streaming' ? ' data-streaming="1"' : ''}>${content}</div>`;
}

function scrollToBottom(thread, behavior = 'auto') {
  requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior }));
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function historyFromPayload(payload) {
  const session = payload?.session || payload || {};
  return Array.isArray(session.history) ? session.history : (Array.isArray(payload?.history) ? payload.history : []);
}

const CHAT_ICONS = {
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 12.5 6.6-6.6a3.5 3.5 0 0 1 5 5l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4l2-2h4l2 2h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8"/></svg>',
};

export async function mountChatPage({ shell, gateway, gateways, chatStore, sessionId, sessionRef }) {
  const id = String(sessionId || 'mobile_default');
  const gatewayId = gateway.id;
  const ref = String(sessionRef || `${gatewayId}::${id}`);
  const contextStorageKey = 'pm_mobile_v2_chat_context';
  const pendingDraftStorageKey = 'pm_mobile_v2_pending_chat_draft';
  const weatherSelections = new Map();
  let pendingDraft = null;
  let rememberedContext = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingDraftStorageKey) || 'null');
    if (saved?.ref === ref) pendingDraft = saved;
  } catch {}
  let selectedGatewayId = String(pendingDraft?.gatewayId || gatewayId);
  let selectedProjectId = String(pendingDraft?.projectId || '');
  let selectedProjectName = String(pendingDraft?.projectName || '');
  let sessionProjectId = String(pendingDraft?.projectId || '');
  let sessionProjectName = String(pendingDraft?.projectName || '');
  try {
    rememberedContext = JSON.parse(localStorage.getItem(contextStorageKey) || 'null');
  } catch {}
  let streamController = null;
  let destroyed = false;
  let firstRender = true;
  let attachments = [];
  let queuedPrompts = [];
  let queueDrainPromise = null;
  const queueStorageKey = `pm_mobile_v2_chat_queue:${ref}`;
  try {
    const savedQueue = JSON.parse(sessionStorage.getItem(queueStorageKey) || '[]');
    if (Array.isArray(savedQueue)) queuedPrompts = savedQueue.slice(-10).filter((item) => item && (String(item.text || '').trim() || item.attachments?.length));
  } catch {}
  let reconcilePromise = null;
  let interactionSyncPromise = null;
  let eventSocket = null;
  let eventReconnectTimer = null;
  let eventReconnectDelay = 1000;

  shell.setActiveTab('chat');
  shell.setTitle('Prometheus');
  shell.renderHeader?.({
    rightActions: `<button class="pm-icon-btn" type="button" data-action="new-chat" aria-label="New chat">${ICONS.plus}</button>`,
  });
  try { localStorage.setItem('pm_mobile_v2_active_session', ref); } catch {}
  gateways?.bindSession?.(id, gatewayId);
  ensureChatInteractionStyles();

  shell.page.innerHTML = `<section class="pm-v2-chat-screen">
    <div class="pm-chat-thread pm-v2-chat-thread" id="pm-v2-chat-thread"><div class="pm-v2-chat-loading">Loading chat…</div></div>
    <div class="pm-new-chat-context-dock pm-v2-chat-context-dock" id="pm-new-chat-context-dock" aria-label="New chat direction" hidden>
      <button type="button" class="pm-new-chat-context-row" id="pm-chat-target-chip" aria-label="Current gateway target" aria-expanded="false">
        <span class="pm-new-chat-context-icon" aria-hidden="true">${CHAT_ICONS.monitor}</span>
        <span class="pm-new-chat-context-value"><strong data-v2-gateway-name></strong></span>
        <span class="pm-new-chat-context-chevron" aria-hidden="true">${ICONS.chevron}</span>
      </button>
      <button type="button" class="pm-new-chat-context-row" id="pm-new-chat-project" aria-label="Current directed chat" aria-expanded="false">
        <span class="pm-new-chat-context-icon" aria-hidden="true">${CHAT_ICONS.folder}</span>
        <span class="pm-new-chat-context-value"><strong data-v2-project-name>Chat</strong><small>Directed chat</small></span>
        <span class="pm-new-chat-context-chevron" aria-hidden="true">${ICONS.chevron}</span>
      </button>
    </div>
    <div class="pm-mobile-queued-prompts pm-v2-queue-dock" id="pm-v2-queue-dock" aria-label="Queued messages" hidden></div>
    <div class="pm-chat-mode-launcher pm-v2-chat-mode-launcher" id="pm-chat-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" data-pm-chat-mode="voice" aria-label="Start voice mode">${ICONS.micSmall || ICONS.mic}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" data-pm-chat-mode="keyboard" aria-label="Open keyboard composer">${CHAT_ICONS.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>
    <form class="pm-composer pm-v2-composer pm-composer-mode-hidden" id="pm-composer" aria-hidden="true" inert>
      <span class="pm-glass-lens" aria-hidden="true"></span><span class="pm-glass-border" aria-hidden="true"></span>
      <div class="pm-v2-question-dock" id="pm-v2-question-dock" aria-label="Prometheus question" hidden></div>
      <div class="pm-v2-attachment-strip" data-v2-attachments hidden></div>
      <input id="pm-file-input" class="pm-native-file-input" type="file" multiple hidden accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" />
      <input id="pm-camera-input" class="pm-native-file-input" type="file" hidden accept="image/*" capture="environment" />
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn pm-attach-native-btn pm-v2-attach" id="pm-attach-btn" aria-label="Attach files" aria-expanded="false">${CHAT_ICONS.paperclip}</button>
        <div class="pm-composer-input-wrap pm-v2-input-wrap"><textarea class="pm-composer-input" id="pm-v2-input" rows="1" placeholder="Message Prometheus" aria-label="Message Prometheus" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter"></textarea></div>
        <button type="button" class="pm-icon-btn pm-v2-mic" aria-label="Voice">${ICONS.mic}</button>
        <button class="pm-send pm-v2-send" type="submit" aria-label="Send">${ICONS.send}</button>
      </div>
      <div class="pm-attach-sheet" id="pm-attach-sheet" hidden>
        <div class="pm-attach-sheet-scrim" id="pm-attach-sheet-scrim"></div>
        <section class="pm-attach-sheet-panel" aria-label="Attach">
          <span class="pm-attach-goo" aria-hidden="true"></span>
          <button type="button" class="pm-attach-sheet-action pm-attach-sheet-action--files" data-pm-attach-action="files-photos" aria-label="Files and photos"><span>${CHAT_ICONS.image}</span><strong class="pm-attach-sheet-action-label">Files and photos</strong></button>
          <button type="button" class="pm-attach-sheet-action pm-attach-sheet-action--camera" data-pm-attach-action="camera" aria-label="Camera"><span>${CHAT_ICONS.camera}</span><strong class="pm-attach-sheet-action-label">Camera</strong></button>
        </section>
      </div>
    </form>
  </section>`;

  const thread = shell.page.querySelector('#pm-v2-chat-thread');
  const composer = shell.page.querySelector('#pm-composer');
  const input = shell.page.querySelector('#pm-v2-input');
  const send = shell.page.querySelector('.pm-v2-send');
  const fileInput = shell.page.querySelector('#pm-file-input');
  const cameraInput = shell.page.querySelector('#pm-camera-input');
  const attachmentStrip = shell.page.querySelector('[data-v2-attachments]');
  const questionDock = shell.page.querySelector('#pm-v2-question-dock');
  const contextDock = shell.page.querySelector('#pm-new-chat-context-dock');
  const queueDock = shell.page.querySelector('#pm-v2-queue-dock');
  const targetChip = shell.page.querySelector('#pm-chat-target-chip');
  const projectChip = shell.page.querySelector('#pm-new-chat-project');
  const modeLauncher = shell.page.querySelector('#pm-chat-mode-launcher');
  const attachSheet = shell.page.querySelector('#pm-attach-sheet');
  const attachButton = shell.page.querySelector('#pm-attach-btn');
  let contextPopover = null;
  let contextPopoverScrim = null;
  let contextPopoverEscapeHandler = null;
  let attachOutsidePointerDown = null;
  let attachCloseTimer = null;
  let composerModeOpen = false;

  function selectedGateway() {
    return gateways?.get?.(selectedGatewayId) || gateways?.get?.(gatewayId) || { id: gatewayId, name: gateway.name || 'This gateway' };
  }

  function persistChatContext() {
    try {
      localStorage.setItem(contextStorageKey, JSON.stringify({
        gatewayId: selectedGatewayId,
        projectId: selectedProjectId,
        projectName: selectedProjectName,
      }));
    } catch {}
  }

  function renderContextChips() {
    const entry = selectedGateway();
    const gatewayName = contextDock?.querySelector('[data-v2-gateway-name]');
    const projectName = contextDock?.querySelector('[data-v2-project-name]');
    if (gatewayName) gatewayName.textContent = entry.name || 'This gateway';
    if (projectName) projectName.textContent = selectedProjectName || 'Chat';
    targetChip?.setAttribute('aria-label', `Gateway target: ${entry.name || 'This gateway'}`);
    projectChip?.setAttribute('aria-label', `Directed chat: ${selectedProjectName || 'Chat'}`);
  }

  function persistQueue() {
    try { sessionStorage.setItem(queueStorageKey, JSON.stringify(queuedPrompts.slice(-10))); } catch {}
    renderQueueDock();
  }

  function renderQueueDock() {
    if (!queueDock) return;
    queueDock.hidden = queuedPrompts.length === 0;
    if (!queuedPrompts.length) {
      queueDock.innerHTML = '';
      shell.page.style.setProperty('--pm-v2-queue-height', '0px');
      return;
    }
    const streaming = chatStore.get(gatewayId, id).streaming;
    queueDock.innerHTML = `<div class="pm-v2-queue-head"><span><strong>${queuedPrompts.length} queued</strong><small>${streaming ? 'Will send after this reply' : 'Ready to send'}</small></span>${streaming ? '' : '<button type="button" data-queue-run>Send queued</button>'}</div><div class="pm-v2-queue-list">${queuedPrompts.map((item, index) => `<div class="pm-v2-queue-item"><button type="button" data-queue-edit="${index}" aria-label="Edit queued message">${escapeHtml(String(item.text || 'Attached file(s)').slice(0, 120))}${item.attachments?.length ? `<em>+${item.attachments.length}</em>` : ''}</button><button type="button" data-queue-remove="${index}" aria-label="Remove queued message">×</button></div>`).join('')}</div>`;
    shell.page.style.setProperty('--pm-v2-queue-height', `${Math.ceil(queueDock.getBoundingClientRect().height) + 12}px`);
  }

  function applySessionContext(payload) {
    const session = payload?.session || payload || {};
    const project = session.project || {};
    const projectId = String(session.projectId || project.id || '');
    const projectName = String(session.projectName || project.name || '');
    const hasMessages = chatStore.get(gatewayId, id).messages.length > 0;
    sessionProjectId = projectId;
    sessionProjectName = projectName;
    if (hasMessages) {
      selectedGatewayId = gatewayId;
      selectedProjectId = projectId;
      selectedProjectName = projectName;
    } else if (pendingDraft) {
      selectedGatewayId = String(pendingDraft.gatewayId || gatewayId);
      selectedProjectId = String(pendingDraft.projectId || projectId);
      selectedProjectName = String(pendingDraft.projectName || projectName);
      sessionProjectId = String(pendingDraft.projectId || projectId);
      sessionProjectName = String(pendingDraft.projectName || projectName);
    } else if (gateways?.get?.(rememberedContext?.gatewayId)) {
      selectedGatewayId = String(rememberedContext.gatewayId);
      if (selectedGatewayId === gatewayId) {
        selectedProjectId = String(rememberedContext.projectId || '');
        selectedProjectName = String(rememberedContext.projectName || '');
      } else {
        selectedProjectId = '';
        selectedProjectName = '';
      }
    } else {
      selectedGatewayId = gatewayId;
      selectedProjectId = projectId;
      selectedProjectName = projectName;
    }
    renderContextChips();
  }

  function setComposerMode(open, { animate = true, focus = false } = {}) {
    composerModeOpen = !!open;
    composer.classList.toggle('pm-composer-mode-hidden', !composerModeOpen);
    composer.setAttribute('aria-hidden', composerModeOpen ? 'false' : 'true');
    if (composerModeOpen) composer.removeAttribute('inert');
    else {
      composer.setAttribute('inert', '');
      closeAttachmentSheet();
    }
    modeLauncher?.setAttribute('aria-hidden', composerModeOpen ? 'true' : 'false');
    modeLauncher?.classList.toggle('is-transitioning', !!animate);
    if (modeLauncher) window.setTimeout(() => modeLauncher.classList.remove('is-transitioning'), 360);
    if (focus && composerModeOpen) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  function closeContextPopover() {
    if (!contextPopover && !contextPopoverScrim) return;
    if (contextPopoverEscapeHandler) document.removeEventListener('keydown', contextPopoverEscapeHandler, true);
    contextPopover?.remove();
    contextPopoverScrim?.remove();
    contextPopover = null;
    contextPopoverScrim = null;
    contextDock?.classList.remove('pm-context-popover-open');
    document.body.classList.remove('pm-mobile-context-popover-open');
    document.body.classList.remove('pm-new-project-dialog-open');
    targetChip?.setAttribute('aria-expanded', 'false');
    projectChip?.setAttribute('aria-expanded', 'false');
  }

  async function openContextPopover(type) {
    if (!contextDock || !contextDock.isConnected) return;
    if (contextPopover?.dataset.popoverType === type) { closeContextPopover(); return; }
    closeContextPopover();
    closeAttachmentSheet();
    const trigger = type === 'gateway' ? targetChip : projectChip;
    const wrapper = document.createElement('div');
    wrapper.className = 'pm-chat-settings-popover pm-new-chat-context-popover';
    wrapper.dataset.popoverType = type === 'gateway' ? 'target' : 'project';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', type === 'gateway' ? 'Gateway target' : 'Directed chat');
    wrapper.innerHTML = `<div class="pm-new-chat-context-popover-title">${type === 'gateway' ? 'Connected computer' : 'Directed chat'}</div><div class="pm-new-chat-context-loading">Loading ${type === 'gateway' ? 'gateways' : 'projects'}…</div>`;
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'pm-chat-target-popover-scrim';
    scrim.setAttribute('aria-label', 'Close picker');
    contextDock.append(wrapper);
    document.body.append(scrim);
    contextPopover = wrapper;
    contextPopoverScrim = scrim;
    contextDock.classList.add('pm-context-popover-open');
    document.body.classList.add('pm-mobile-context-popover-open');
    trigger?.setAttribute('aria-expanded', 'true');
    contextPopoverEscapeHandler = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeContextPopover(); }
    };
    document.addEventListener('keydown', contextPopoverEscapeHandler, true);
    scrim.addEventListener('click', closeContextPopover, { once: true });

    try {
      if (type === 'gateway') {
        const entries = gateways?.list?.() || [];
        wrapper.querySelector('.pm-new-chat-context-loading').outerHTML = entries.length
          ? entries.map((entry) => `<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option" data-chat-target-id="${escapeHtml(entry.id)}" aria-selected="${String(entry.id === selectedGatewayId)}"><span class="pm-new-chat-context-option-icon" aria-hidden="true">${CHAT_ICONS.monitor}</span><span class="pm-new-chat-context-option-copy"><strong>${escapeHtml(entry.name || 'Gateway')}</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">${entry.id === selectedGatewayId ? '✓' : ''}</span></button>`).join('')
          : '<div class="pm-new-chat-context-loading">No gateways are paired.</div>';
        wrapper.querySelectorAll('[data-chat-target-id]').forEach((button) => button.addEventListener('click', () => {
          const nextId = String(button.dataset.chatTargetId || '');
          if (!gateways?.get?.(nextId)) return;
          if (nextId !== selectedGatewayId && attachments.length) {
            shell.showNotice('Remove uploaded files before changing gateway so they stay with the right workspace.');
            return;
          }
          selectedGatewayId = nextId;
          if (selectedGatewayId !== gatewayId) { selectedProjectId = ''; selectedProjectName = ''; }
          try { gateways.select(nextId); } catch {}
          persistChatContext();
          renderContextChips();
          closeContextPopover();
        }));
        return;
      }

      const projectsClient = gateways?.client?.(selectedGatewayId) || gateway;
      const response = await projectsClient.request('/api/projects');
      if (!contextPopover || contextPopover !== wrapper) return;
      const projects = (Array.isArray(response) ? response : response?.projects || []).filter((project) => project?.id);
      const newProjectButton = '<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option pm-new-project-option" data-new-project="true"><span class="pm-new-chat-context-option-icon" aria-hidden="true">+</span><span class="pm-new-chat-context-option-copy"><strong>New project</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">›</span></button>';
      const chatOption = { id: '', name: 'Chat' };
      const options = [chatOption, ...projects];
      wrapper.querySelector('.pm-new-chat-context-loading').outerHTML = `${newProjectButton}${options.map((project) => {
        const selected = String(project.id || '') === selectedProjectId;
        return `<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option" data-project-id="${escapeHtml(project.id || '')}" aria-selected="${String(selected)}"><span class="pm-new-chat-context-option-icon" aria-hidden="true">${project.id ? CHAT_ICONS.folder : ICONS.chat}</span><span class="pm-new-chat-context-option-copy"><strong>${escapeHtml(project.name)}</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">${selected ? '✓' : ''}</span></button>`;
      }).join('')}`;
      wrapper.querySelectorAll('[data-project-id]').forEach((button) => button.addEventListener('click', () => {
        selectedProjectId = String(button.dataset.projectId || '');
        selectedProjectName = selectedProjectId ? String(projects.find((project) => String(project.id) === selectedProjectId)?.name || 'Project') : '';
        persistChatContext();
        renderContextChips();
        closeContextPopover();
      }));
      wrapper.querySelector('[data-new-project]')?.addEventListener('click', () => {
        wrapper.classList.add('pm-new-project-popover');
        document.body.classList.add('pm-new-project-dialog-open');
        wrapper.innerHTML = `<div class="pm-new-chat-context-popover-title">New project</div><form class="pm-new-project-form"><label class="pm-new-project-label" for="pm-v2-new-project-name">Project name</label><input id="pm-v2-new-project-name" class="pm-new-project-input" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Mobile app"/><div class="pm-new-project-error" role="alert" hidden></div><div class="pm-new-project-actions"><button type="button" class="pm-new-project-button" data-project-cancel>Cancel</button><button type="submit" class="pm-new-project-button pm-new-project-confirm">Create</button></div></form>`;
        const form = wrapper.querySelector('form');
        const nameInput = wrapper.querySelector('#pm-v2-new-project-name');
        const error = wrapper.querySelector('.pm-new-project-error');
        wrapper.querySelector('[data-project-cancel]')?.addEventListener('click', closeContextPopover);
        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const name = nameInput.value.trim();
          if (!name) { error.textContent = 'Enter a project name.'; error.hidden = false; return; }
          const createButton = form.querySelector('[type="submit"]');
          createButton.disabled = true;
          error.hidden = true;
          try {
            const created = await projectsClient.request('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
            const project = created?.project || created;
            if (!project?.id) throw new Error('Prometheus did not return the new project.');
            selectedProjectId = String(project.id);
            selectedProjectName = String(project.name || name);
            persistChatContext();
            renderContextChips();
            closeContextPopover();
          } catch (errorValue) {
            error.textContent = String(errorValue?.message || errorValue || 'Could not create project.');
            error.hidden = false;
            createButton.disabled = false;
          }
        });
        requestAnimationFrame(() => nameInput?.focus({ preventScroll: true }));
      });
    } catch (error) {
      const loading = wrapper.querySelector('.pm-new-chat-context-loading');
      if (loading) loading.textContent = String(error?.message || 'Could not load this list.');
    }
  }

  function closeAttachmentSheet() {
    if (!attachSheet) return;
    attachSheet.classList.remove('open');
    attachButton?.setAttribute('aria-expanded', 'false');
    contextDock?.classList.remove('pm-attach-popover-open');
    if (attachOutsidePointerDown) document.removeEventListener('pointerdown', attachOutsidePointerDown, true);
    attachOutsidePointerDown = null;
    if (attachCloseTimer) window.clearTimeout(attachCloseTimer);
    attachCloseTimer = window.setTimeout(() => {
      if (!attachSheet.classList.contains('open')) attachSheet.hidden = true;
      attachCloseTimer = null;
    }, 360);
  }

  function openAttachmentSheet() {
    if (!attachSheet || !composerModeOpen) return;
    if (attachCloseTimer) window.clearTimeout(attachCloseTimer);
    attachCloseTimer = null;
    closeContextPopover();
    attachSheet.hidden = false;
    attachSheet.classList.remove('open');
    contextDock?.classList.add('pm-attach-popover-open');
    attachButton?.setAttribute('aria-expanded', 'true');
    const position = () => {
      const anchor = attachButton?.getBoundingClientRect?.();
      const owner = composer.getBoundingClientRect();
      if (!anchor) return;
      const x = anchor.left + anchor.width / 2;
      const y = anchor.top + anchor.height / 2;
      attachSheet.style.setProperty('--pm-attach-origin-x', `${Math.round(x - owner.left)}px`);
      attachSheet.style.setProperty('--pm-attach-origin-y', `${Math.round(y - owner.top)}px`);
      const viewportWidth = Math.max(160, window.visualViewport?.width || window.innerWidth || 390);
      const orbitY = -Math.max(74, Math.round(y - owner.top) + 40);
      const nearLeft = x < 118;
      const nearRight = x > viewportWidth - 118;
      const file = nearLeft ? [38, orbitY - 46] : nearRight ? [-82, orbitY] : [-48, orbitY - 46];
      const camera = nearLeft ? [82, orbitY] : nearRight ? [-38, orbitY - 46] : [48, orbitY];
      const setOrbit = (name, [dx, dy]) => {
        attachSheet.style.setProperty(`--pm-attach-${name}-x`, `${dx}px`);
        attachSheet.style.setProperty(`--pm-attach-${name}-y`, `${dy}px`);
        attachSheet.style.setProperty(`--pm-attach-${name}-angle`, `${Math.atan2(dy, dx) * 180 / Math.PI}deg`);
        attachSheet.style.setProperty(`--pm-attach-${name}-length`, `${Math.hypot(dx, dy)}px`);
      };
      setOrbit('files', file);
      setOrbit('camera', camera);
    };
    position();
    requestAnimationFrame(() => { position(); attachSheet.classList.add('open'); });
    attachOutsidePointerDown = (event) => {
      if (attachSheet.contains(event.target) || attachButton?.contains(event.target)) return;
      closeAttachmentSheet();
    };
    document.addEventListener('pointerdown', attachOutsidePointerDown, true);
  }

  renderContextChips();

  async function syncPendingInteractions() {
    if (destroyed || interactionSyncPromise || typeof gateway.pendingInteractions !== 'function') return interactionSyncPromise;
    interactionSyncPromise = gateway.pendingInteractions(id).then(({ approvals, questions }) => {
      if (destroyed) return;
      approvals.forEach((approval) => chatStore.upsertInteraction(gatewayId, id, 'approval', approval));
      questions.forEach((question) => chatStore.upsertInteraction(gatewayId, id, 'question', question));
    }).catch(() => {}).finally(() => { interactionSyncPromise = null; });
    return interactionSyncPromise;
  }

  function applyGatewayEvent(message) {
    const type = String(message?.type || '').toLowerCase();
    const approval = message?.approval || {};
    const question = message?.question || {};
    const eventSessionId = message?.sessionId || approval.sessionId || approval.sourceSessionId || question.sessionId || question.sourceSessionId;
    if (String(eventSessionId || '') !== id) return;

    if (type.startsWith('approval_')) {
      const id = String(approval.id || message.approvalId || approval.approvalId || '');
      if (!id) return;
      const statusByType = {
        approval_created: 'pending', approval_approved: 'approved', approval_denied: 'rejected',
        approval_rejected: 'rejected', approval_cancelled: 'cancelled', approval_expired: 'expired',
        approval_executed: 'executed', approval_failed: 'failed',
      };
      chatStore.upsertInteraction(gatewayId, sessionId, 'approval', {
        ...approval,
        id,
        status: approval.status || message.status || statusByType[type] || 'pending',
        summary: approval.summary || message.summary,
        toolName: approval.toolName || message.toolName,
        sessionId: eventSessionId,
      });
      return;
    }

    if (type.startsWith('question_')) {
      const id = String(question.id || message.questionId || question.questionId || '');
      if (!id) return;
      const statusByType = {
        question_created: 'pending', question_answered: 'answered',
        question_cancelled: 'cancelled', question_expired: 'expired',
      };
      chatStore.upsertInteraction(gatewayId, sessionId, 'question', {
        ...question,
        id,
        status: question.status || message.status || statusByType[type] || 'pending',
        prompt: question.prompt || message.summary,
        sessionId: eventSessionId,
      });
    }
  }

  function connectEventSocket() {
    if (destroyed || eventSocket || typeof WebSocket === 'undefined') return;
    let socket;
    try { socket = new WebSocket(gateway.wsUrl('/ws')); }
    catch { scheduleEventSocketReconnect(); return; }
    eventSocket = socket;
    socket.addEventListener('open', () => {
      if (eventSocket !== socket || destroyed) return;
      eventReconnectDelay = 1000;
      syncPendingInteractions();
    });
    socket.addEventListener('message', (event) => {
      if (eventSocket !== socket || destroyed) return;
      try { applyGatewayEvent(JSON.parse(event.data)); } catch {}
    });
    socket.addEventListener('close', () => {
      if (eventSocket !== socket) return;
      eventSocket = null;
      scheduleEventSocketReconnect();
    });
    socket.addEventListener('error', () => { try { socket.close(); } catch {} });
  }

  function scheduleEventSocketReconnect() {
    if (destroyed || eventReconnectTimer) return;
    const delay = eventReconnectDelay;
    eventReconnectDelay = Math.min(eventReconnectDelay * 2, 30_000);
    eventReconnectTimer = window.setTimeout(() => {
      eventReconnectTimer = null;
      connectEventSocket();
    }, delay);
  }

  function paintAttachments() {
    attachmentStrip.hidden = !attachments.length;
    attachmentStrip.innerHTML = attachments.map((item, index) => `<span class="pm-attach-chip"><span>${escapeHtml(item.name)}</span><button type="button" data-remove-attachment="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join('');
    composer.classList.toggle('has-attachments', attachments.length > 0);
  }

  function render(state) {
    if (destroyed) return;
    const stick = firstRender || (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120);
    thread.innerHTML = state.messages.length
      ? state.messages.map((message, index) => messageMarkup(message, index, gateway, shell, weatherSelections)).join('')
      : '<div class="pm-v2-chat-empty"><strong>Prometheus</strong><span>What can I help you with?</span></div>';
    if (state.hasOlder) thread.insertAdjacentHTML('afterbegin', '<button class="pm-v2-load-older" type="button">Load earlier messages</button>');
    if (state.error) thread.insertAdjacentHTML('beforeend', `<div class="pm-v2-stream-error">${escapeHtml(state.error)}</div>`);
    composer.classList.toggle('is-streaming', state.streaming);
    send.classList.toggle('is-abort', state.streaming);
    contextDock.hidden = false;
    renderQueueDock();
    if (state.messages.length && !composerModeOpen) setComposerMode(true, { animate: false });
    if (stick) scrollToBottom(thread);
    firstRender = false;
  }

  const unsubscribe = chatStore.subscribe(gatewayId, id, render);
  ensureMobileV2Markdown().then((ready) => {
    if (ready && !destroyed) render(chatStore.get(gatewayId, id));
  });

  async function load() {
    chatStore.setLoading(gatewayId, id, true);
    try {
      const payload = await gateway.getSession(id);
      chatStore.hydrate(gatewayId, id, payload);
      applySessionContext(payload);
      await syncPendingInteractions();
    } catch (error) {
      if (Number(error?.status) === 404) {
        try {
          await gateway.createSession({ id, title: 'New Chat' });
          const payload = await gateway.getSession(id);
          chatStore.hydrate(gatewayId, id, payload);
          applySessionContext(payload);
          await syncPendingInteractions();
        } catch (inner) {
          chatStore.mutate(gatewayId, id, (state) => { state.loading = false; state.error = String(inner?.message || inner); });
        }
      } else {
        chatStore.mutate(gatewayId, id, (state) => { state.loading = false; state.error = String(error?.message || error || 'Could not load this chat.'); });
      }
    }
  }

  async function reconcile({ announce = false } = {}) {
    if (destroyed || chatStore.get(gatewayId, id).streaming) return false;
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      try {
        const payload = await gateway.getSession(id);
        if (destroyed) return false;
        const remoteHistory = historyFromPayload(payload);
        const local = chatStore.get(gatewayId, id).messages;
        if (remoteHistory.length || !local.length) {
          chatStore.hydrate(gatewayId, id, payload);
          if (announce) shell.showNotice('Chat reconnected and synced.');
          return true;
        }
      } catch {}
      return false;
    })().finally(() => { reconcilePromise = null; });
    return reconcilePromise;
  }

  async function loadOlder() {
    const state = chatStore.get(gatewayId, id);
    if (!state.hasOlder || !state.olderCursor) return;
    const beforeHeight = thread.scrollHeight;
    try {
      const page = await gateway.getHistoryPage(id, { limit: 80, before: state.olderCursor });
      chatStore.prependHistory(gatewayId, id, page);
      requestAnimationFrame(() => { thread.scrollTop += thread.scrollHeight - beforeHeight; });
    } catch (error) {
      shell.showNotice(error?.message || 'Could not load earlier messages.');
    }
  }

  async function runStream({ message, requestPrefix = 'mobile_v2', attachments: streamAttachments, appendUser = false }) {
    const text = String(message || '').trim();
    if (!text || destroyed || chatStore.get(gatewayId, id).streaming) return false;
    const requestId = `${requestPrefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
    const assistantId = `${requestId}:assistant`;
    if (appendUser) chatStore.appendUser(gatewayId, id, { id: requestId, text, attachments: streamAttachments });
    chatStore.beginAssistant(gatewayId, id, assistantId);
    streamController = new AbortController();
    try {
      await gateway.streamChat({
        sessionId: id,
        message: text,
        clientRequestId: requestId,
        attachments: streamAttachments,
        signal: streamController.signal,
        onEvent: (event) => chatStore.applyStreamEvent(gatewayId, id, assistantId, event),
      });
      const state = chatStore.get(gatewayId, id);
      const row = state.messages.find((item) => item.id === assistantId);
      if (row?.status === 'streaming') chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.done' });
      shell.refreshSessions();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.error', message: 'Stopped' });
      } else {
        chatStore.failStream(gatewayId, id, assistantId, error);
        await reconcile({ announce: true });
      }
      return false;
    } finally {
      streamController = null;
      renderQueueDock();
      if (queuedPrompts.length && !destroyed) queueMicrotask(() => { drainQueuedPrompts().catch(() => {}); });
    }
  }

  async function drainQueuedPrompts() {
    if (queueDrainPromise) return queueDrainPromise;
    if (chatStore.get(gatewayId, id).streaming || streamController) {
      shell.showNotice('Queued messages will send when the current reply ends.');
      return false;
    }
    queueDrainPromise = (async () => {
      while (!destroyed && queuedPrompts.length && !chatStore.get(gatewayId, id).streaming) {
        const next = queuedPrompts.shift();
        persistQueue();
        const sent = await runStream({
          message: next.text || 'Please inspect the attached file(s).',
          requestPrefix: 'mobile_v2_queued',
          attachments: Array.isArray(next.attachments) ? next.attachments : [],
          appendUser: true,
        });
        if (!sent) break;
      }
    })().finally(() => { queueDrainPromise = null; renderQueueDock(); });
    return queueDrainPromise;
  }

  function enqueuePrompt(text, sentAttachments) {
    if (queuedPrompts.length >= 10) {
      shell.showNotice('The chat queue is full. Remove a queued message to add another.');
      return false;
    }
    queuedPrompts.push({ text: String(text || ''), attachments: sentAttachments.map((item) => ({ ...item })), createdAt: Date.now() });
    persistQueue();
    input.value = '';
    composer.classList.remove('has-text', 'is-focused');
    input.style.height = '';
    attachments = [];
    paintAttachments();
    shell.showNotice('Message queued after the current reply.');
    return true;
  }

  async function resumeInterruptedTurn(prompt) {
    const message = String(prompt || '').trim();
    if (!message) return false;
    if (chatStore.get(gatewayId, id).streaming) {
      shell.showNotice('The current turn is still running.');
      return false;
    }
    shell.showNotice('Resuming interrupted work…');
    return runStream({ message, requestPrefix: 'mobile_v2_resume', appendUser: false });
  }

  const disposeInteractions = attachChatInteractionHandlers({
    thread,
    questionHost: questionDock,
    questionStorageKey: (questionId) => questionDraftStorageKey(gatewayId, id, questionId),
    gateway,
    chatStore,
    gatewayId,
    sessionId: id,
    showNotice: (message) => shell.showNotice(message),
    onResumePrompt: resumeInterruptedTurn,
  });
  const disposeArtifactHandlers = attachChatArtifactHandlers({
    thread,
    gateway,
    chatStore,
    gatewayId,
    sessionId: id,
    weatherSelections,
    showNotice: (message) => shell.showNotice(message),
  });

  async function submit() {
    const text = input.value.trim();
    const current = chatStore.get(gatewayId, id);
    const needsTargetSession = selectedGatewayId !== gatewayId || selectedProjectId !== sessionProjectId;
    if ((current.streaming || streamController) && !needsTargetSession) {
      if (text || attachments.length) {
        const sentAttachments = attachments.map((item) => ({ name: item.name, path: item.path, mimeType: item.mimeType, size: item.size }));
        return enqueuePrompt(text, sentAttachments);
      }
      streamController?.abort();
      return true;
    }
    if (!text && !attachments.length) return;
    const sentAttachments = attachments.map((item) => ({ name: item.name, path: item.path, mimeType: item.mimeType, size: item.size }));
    if (needsTargetSession) {
      try {
        const targetClient = gateways?.client?.(selectedGatewayId);
        if (!targetClient) throw new Error('That gateway is no longer available.');
        const targetSessionId = selectedProjectId ? '' : `mobile_v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        let created;
        if (selectedProjectId) {
          created = await targetClient.request(`/api/projects/${encodeURIComponent(selectedProjectId)}/sessions`, {
            method: 'POST', body: JSON.stringify({ title: 'New Chat', isOnboarding: false }),
          });
        } else {
          created = await targetClient.createSession({ id: targetSessionId, title: 'New Chat' });
        }
        const nextId = String(created?.sessionId || created?.session?.id || created?.id || targetSessionId || '').trim();
        if (!nextId) throw new Error('Prometheus did not return a chat session.');
        const nextRef = gateways.bindSession(nextId, selectedGatewayId) || `${selectedGatewayId}::${nextId}`;
        const draft = {
          ref: nextRef,
          gatewayId: selectedGatewayId,
          projectId: selectedProjectId,
          projectName: selectedProjectName,
          text,
          attachments: sentAttachments,
        };
        try { sessionStorage.setItem(pendingDraftStorageKey, JSON.stringify(draft)); }
        catch { throw new Error('This browser could not preserve the draft while opening the selected chat.'); }
        try { localStorage.setItem('pm_mobile_v2_active_session', nextRef); } catch {}
        shell.navigate(`chat/${encodeURIComponent(nextRef)}`);
        return true;
      } catch (error) {
        shell.showNotice(error?.message || 'Could not open the selected chat.');
        return false;
      }
    }
    input.value = '';
    composer.classList.remove('has-text', 'is-focused');
    attachments = [];
    paintAttachments();
    await runStream({
      message: text || 'Please inspect the attached file(s).',
      requestPrefix: 'mobile_v2',
      attachments: sentAttachments,
      appendUser: true,
    });
  }

  async function addFiles(files) {
    for (const file of files) {
      try {
        shell.showNotice(`Uploading ${file.name}…`);
        const base64 = await fileBase64(file);
        const uploadGateway = gateways?.client?.(selectedGatewayId) || gateway;
        const result = await uploadGateway.uploadBinaryFile({ filename: file.name, base64, mimeType: file.type || 'application/octet-stream' });
        const path = result?.absPath || result?.path || result?.relPath || '';
        if (!path) throw new Error('Upload did not return a workspace path.');
        attachments.push({ name: file.name, path, mimeType: file.type || 'application/octet-stream', size: file.size });
        paintAttachments();
      } catch (error) {
        shell.showNotice(`${file.name}: ${error?.message || 'Upload failed.'}`);
      }
    }
    if (attachments.length) shell.showNotice(`${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready.`);
  }

  async function performMessageAction(action, messageIndex) {
    const message = chatStore.get(gatewayId, id).messages[messageIndex];
    if (!message || message.role === 'user') return;
    const text = messageText(message).trim();
    if (action === 'copy') {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      shell.showNotice('Response copied.');
      return;
    }
    if (action === 'speak') {
      if (!text || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        shell.showNotice('Speech playback is unavailable in this browser.');
        return;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      return;
    }
    if (action === 'fork') {
      try {
        const history = chatStore.get(gatewayId, id).messages.slice(0, messageIndex + 1).map((item) => ({
          id: item.id,
          role: item.role === 'user' ? 'user' : 'assistant',
          content: messageText(item),
          body: { ...(item.body && typeof item.body === 'object' ? item.body : {}), text: messageText(item) },
          timestamp: Number(item.createdAt || item.timestamp || Date.now()),
          attachmentPreviews: item.attachmentPreviews,
          files: item.files,
          generatedImages: item.generatedImages,
          generatedVideos: item.generatedVideos,
          richArtifacts: item.richArtifacts,
          approvals: item.approvals,
          questions: item.questions,
          liveTraceEntries: item.liveTraceEntries,
          processEntries: item.processEntries,
          voiceWorkgroup: item.voiceWorkgroup,
          goalCompletionReport: item.goalCompletionReport,
          fileChanges: item.fileChanges,
        }));
        const title = String(chatStore.get(gatewayId, id).messages.find((item) => item.role === 'user')?.text || 'Forked chat').replace(/\s+/g, ' ').slice(0, 72);
        const nextId = `mobile_v2_fork_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        await gateway.createSession({ id: nextId, title: title || 'Forked chat' });
        await gateway.request(`/api/sessions/${encodeURIComponent(nextId)}/history`, {
          method: 'POST',
          body: JSON.stringify({ history, origin: { channel: 'mobile', surface: 'mobile_app', device: 'phone', source: 'mobile_v2_fork' } }),
        });
        try { await gateway.request(`/api/sessions/${encodeURIComponent(nextId)}/resources/copy-from`, { method: 'POST', body: JSON.stringify({ sourceSessionId: id }) }); } catch {}
        const nextRef = gateways?.bindSession?.(nextId, gatewayId) || `${gatewayId}::${nextId}`;
        try { localStorage.setItem('pm_mobile_v2_active_session', nextRef); } catch {}
        shell.navigate(`chat/${encodeURIComponent(nextRef)}`);
        shell.showNotice('Conversation forked.');
      } catch (error) {
        shell.showNotice(error?.message || 'Could not fork this conversation.');
      }
    }
  }

  const onOnline = () => { reconcile({ announce: true }).catch(() => {}); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') reconcile().catch(() => {});
  };

  thread.addEventListener('click', (event) => {
    if (event.target.closest('.pm-v2-load-older')) { loadOlder(); return; }
    const action = event.target.closest('[data-v2-message-action]');
    if (action) { performMessageAction(action.dataset.v2MessageAction, Number(action.dataset.messageIndex)); return; }
    const linkedThread = event.target.closest('[data-v2-thread]');
    if (linkedThread) {
      const targetGateway = linkedThread.dataset.v2ThreadGateway || gatewayId;
      const targetSession = linkedThread.dataset.v2Thread || '';
      if (!targetSession) return;
      const targetRef = targetSession.includes('::') ? targetSession : `${targetGateway}::${targetSession}`;
      shell.navigate(`chat/${encodeURIComponent(targetRef)}`);
    }
  });
  queueDock?.addEventListener('click', (event) => {
    if (event.target.closest('[data-queue-run]')) { drainQueuedPrompts().catch(() => {}); return; }
    const remove = event.target.closest('[data-queue-remove]');
    if (remove) {
      queuedPrompts.splice(Number(remove.dataset.queueRemove), 1);
      persistQueue();
      return;
    }
    const edit = event.target.closest('[data-queue-edit]');
    if (!edit) return;
    const [queued] = queuedPrompts.splice(Number(edit.dataset.queueEdit), 1);
    if (!queued) return;
    persistQueue();
    input.value = String(queued.text || '');
    attachments = Array.isArray(queued.attachments) ? queued.attachments.map((item) => ({ ...item })) : [];
    paintAttachments();
    composer.classList.toggle('has-text', !!input.value.trim());
    setComposerMode(true, { animate: true, focus: true });
  });
  composer.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
  targetChip?.addEventListener('click', () => openContextPopover('gateway'));
  projectChip?.addEventListener('click', () => openContextPopover('project'));
  modeLauncher?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pm-chat-mode]');
    if (!button) return;
    if (button.dataset.pmChatMode === 'voice') {
      try { localStorage.setItem('pm_mobile_v2_voice_session', id); } catch {}
      shell.navigate('voice');
      return;
    }
    setComposerMode(true, { animate: true, focus: true });
  });
  attachButton?.addEventListener('click', openAttachmentSheet);
  attachSheet?.querySelectorAll('[data-pm-attach-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.pmAttachAction;
    closeAttachmentSheet();
    if (action === 'camera') cameraInput.click();
    else fileInput.click();
  }));
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  cameraInput.addEventListener('change', () => { addFiles([...cameraInput.files]); cameraInput.value = ''; });
  attachmentStrip.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-attachment]');
    if (!button) return;
    attachments.splice(Number(button.dataset.removeAttachment), 1);
    paintAttachments();
  });
  shell.page.querySelector('.pm-v2-mic')?.addEventListener('click', () => {
    try { localStorage.setItem('pm_mobile_v2_voice_session', id); } catch {}
    shell.navigate('voice');
  });
  input.addEventListener('input', () => {
    composer.classList.toggle('has-text', !!input.value.trim());
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, Math.max(44, window.innerHeight * .42))}px`;
  });
  input.addEventListener('focus', () => composer.classList.add('is-focused'));
  input.addEventListener('blur', () => { if (!input.value.trim()) composer.classList.remove('is-focused'); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  connectEventSocket();
  await load();
  if (pendingDraft && !destroyed) {
    try { sessionStorage.removeItem(pendingDraftStorageKey); } catch {}
    selectedGatewayId = String(pendingDraft.gatewayId || gatewayId);
    selectedProjectId = String(pendingDraft.projectId || '');
    selectedProjectName = String(pendingDraft.projectName || '');
    sessionProjectId = selectedProjectId;
    sessionProjectName = selectedProjectName;
    attachments = Array.isArray(pendingDraft.attachments) ? pendingDraft.attachments.filter((item) => item?.path) : [];
    input.value = String(pendingDraft.text || '');
    composer.classList.toggle('has-text', !!input.value.trim());
    paintAttachments();
    renderContextChips();
    setComposerMode(true, { animate: false });
    await submit();
  }
  return () => {
    destroyed = true;
    closeContextPopover();
    closeAttachmentSheet();
    if (attachCloseTimer) window.clearTimeout(attachCloseTimer);
    if (eventReconnectTimer) window.clearTimeout(eventReconnectTimer);
    eventReconnectTimer = null;
    try { eventSocket?.close(1000, 'chat view disposed'); } catch {}
    eventSocket = null;
    streamController?.abort();
    disposeInteractions();
    disposeArtifactHandlers();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsubscribe();
  };
}
