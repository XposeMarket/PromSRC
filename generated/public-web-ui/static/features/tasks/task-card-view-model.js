// Shared Tasks-card view-model ("Option B: Live run cards").
// Pure ES module (no DOM, no globals) used by BOTH the desktop Tasks page and
// the mobile tasks route so card/detail semantics cannot drift.

import { agentModelLabel, providerLogoKey } from '../../components/provider-logo.js';

export const STALL_THRESHOLD_MS = 30 * 60 * 1000;

const ENVELOPE_SECTION = /\n\s*\n\s*(?:ADDITIONAL CONTEXT|CONTEXT DATA|CONTEXT|CONSTRAINTS|SUCCESS CRITERIA|TOOL RULES|EVIDENCE BUS|PROCESS LOG|OUTPUT FORMAT|RULES|DELIVERABLES?|NOTES)\s*:/i;

function str(value) { return value == null ? '' : String(value); }
function oneLine(value) { return str(value).replace(/\s+/g, ' ').trim(); }
function cap(value, max) { const text = oneLine(value); return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text; }

function stripEnvelope(text) {
  let out = str(text).trim();
  if (!out) return '';
  // "Message:\n<body>" dispatch form.
  const message = out.match(/(?:^|\n)Message:\s*\n([\s\S]*?)(?=\n\n(?:CONTEXT DATA|CONSTRAINTS|SUCCESS CRITERIA|EVIDENCE BUS|PROCESS LOG):|$)/i);
  if (message?.[1]?.trim()) return message[1].trim();
  // "[TEAM DISPATCH] ... YOUR TASK: <body>" envelope form (body may be on the same line).
  const task = out.match(/(?:^|\n|\]\s*)(?:YOUR TASK|TASK)\s*:\s*([\s\S]*)$/i);
  if (task?.[1]?.trim()) {
    out = task[1].trim();
    const cut = out.search(ENVELOPE_SECTION);
    if (cut > 0) out = out.slice(0, cut).trim();
    return out;
  }
  return out.replace(/^\s*\[(?:TEAM DISPATCH|DISPATCH|SCHEDULED RUN|TASK)\]\s*/i, '').trim();
}

/** Clean original instruction text: originalAssignment first, else extracted from the envelope prompt. */
export function dispatchedMessage(task) {
  const original = str(task?.originalAssignment || task?.originPrompt).trim();
  if (original) return original;
  const prompt = str(task?.prompt || task?.title).trim();
  if (!prompt) return '';
  return stripEnvelope(prompt) || prompt;
}

/** Raw (envelope) prompt, only when it adds information beyond the clean message. */
export function rawInstructions(task) {
  const prompt = str(task?.prompt).trim();
  if (!prompt) return '';
  return oneLine(prompt) === oneLine(dispatchedMessage(task)) ? '' : prompt;
}

/** Bold card title without the dispatch envelope. */
export function cleanTaskTitle(task) {
  let title = str(task?.title).trim();
  // "Agent: [TEAM DISPATCH] YOUR TASK: ..." -> drop the agent prefix (actor line shows it).
  const prefixed = title.match(/^([^:\n[\]]{1,60}):\s*(\[[A-Z ]+\][\s\S]*|YOUR TASK[\s\S]*)$/i);
  if (prefixed) title = prefixed[2];
  if (/\[(?:TEAM DISPATCH|DISPATCH)\]|(?:^|\s)YOUR TASK\s*:/i.test(title)) {
    const fromTitle = stripEnvelope(title);
    const fromTask = dispatchedMessage(task);
    title = fromTask && !/\[(?:TEAM DISPATCH|DISPATCH)\]/i.test(fromTask) ? fromTask : fromTitle;
  }
  title = oneLine(title).replace(/^\[(?:TEAM DISPATCH|DISPATCH)\]\s*/i, '').replace(/^YOUR TASK\s*:\s*/i, '');
  if (!title) title = oneLine(dispatchedMessage(task)) || 'Untitled task';
  // First sentence/line is enough for a title.
  return cap(title, 120);
}

export function taskKind(task) {
  if (task?.sourceKind === 'planned_chat') return 'plan';
  if (task?.brainJob || /^brain_(?:thought|dream)(?:_|$)/i.test(str(task?.sessionId))) return 'brain';
  if (task?.scheduleId || task?.taskKind === 'scheduled') return 'scheduled';
  if (task?.teamSubagent?.teamId || task?.proposalTeamId) return 'team';
  if (task?.subagentProfile || task?.parentTaskId || task?.teamSubagent?.agentId) return 'subagent';
  return 'background';
}

export function normalizeStatus(status) {
  const s = str(status).trim().toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'succeeded' || s === 'success') return 'complete';
  if (s === 'in_progress' || s === 'waiting_subagent') return 'running';
  if (s === 'interrupted') return 'stalled';
  return s || 'queued';
}

const STATUS_LABEL = {
  running: 'Running', complete: 'Done', failed: 'Failed', cancelled: 'Cancelled', paused: 'Paused', queued: 'Queued',
  stalled: 'Stalled', needs_assistance: 'Needs you', awaiting_user_input: 'Needs you',
};

/** run | ok | warn | bad | muted. failed = bad (red); needs/stalled = warn (amber); queued/paused = muted. */
export function statusTone(status) {
  const s = normalizeStatus(status);
  if (s === 'running') return 'run';
  if (s === 'complete') return 'ok';
  if (s === 'failed') return 'bad';
  if (s === 'needs_assistance' || s === 'awaiting_user_input' || s === 'stalled') return 'warn';
  return 'muted';
}
export const taskStatusTone = statusTone;

export function statusLabel(status) {
  const s = normalizeStatus(status);
  return STATUS_LABEL[s] || s.replace(/_/g, ' ');
}

export function isTerminalStatus(status) {
  return ['complete', 'failed', 'cancelled'].includes(normalizeStatus(status));
}

function stepState(raw) {
  const s = str(raw).toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'skipped') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'running' || s === 'in_progress') return 'current';
  return 'pending';
}

/** {done,total,current,currentText,items:[{text,state,durationMs}]} from plan or runtime progress. */
export function progressSummary(task) {
  const plan = Array.isArray(task?.plan) ? task.plan : [];
  const status = normalizeStatus(task?.status);
  let items = [];
  if (plan.length) {
    const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
    items = plan.map((step, idx) => {
      let state = stepState(step?.status);
      if (state === 'pending' && status === 'running' && idx === currentIndex) state = 'current';
      return { text: oneLine(step?.description || step?.text || step?.title || `Step ${idx + 1}`), state, startedAt: Number(step?.startedAt) || undefined, completedAt: Number(step?.completedAt) || undefined };
    });
  } else if (Array.isArray(task?.runtimeProgress?.items)) {
    items = task.runtimeProgress.items.map((item, idx) => ({
      text: oneLine(item?.text || item?.description || `Step ${idx + 1}`), state: stepState(item?.status),
      startedAt: Number(item?.startedAt) || undefined, completedAt: Number(item?.completedAt) || undefined,
    }));
  }
  if (status === 'complete') items = items.map(item => (item.state === 'current' ? { ...item, state: 'done' } : item));
  // Durations: explicit start/complete, else previous step's completion -> this completion.
  let prevEnd = Number(task?.startedAt || task?.createdAt) || undefined;
  items = items.map((item) => {
    let durationMs;
    const start = item.startedAt || prevEnd;
    if (item.completedAt && start && item.completedAt >= start) durationMs = item.completedAt - start;
    if (item.completedAt) prevEnd = item.completedAt;
    return { ...item, durationMs };
  });
  const done = items.filter(item => item.state === 'done').length;
  let current = items.findIndex(item => item.state === 'current' || item.state === 'failed');
  if (current < 0 && !isTerminalStatus(status)) current = items.findIndex(item => item.state === 'pending');
  return { done, total: items.length, current, currentText: current >= 0 ? items[current].text : '', items };
}

export function lastProgressAt(task) {
  return Number(task?.lastProgressAt || task?.runtimeProgress?.updatedAt || task?.updatedAt || task?.startedAt || task?.createdAt) || 0;
}

/** Running task with no progress for more than 30 minutes. */
export function isLikelyStalled(task, now = Date.now()) {
  if (normalizeStatus(task?.status) !== 'running') return false;
  const last = lastProgressAt(task);
  return last > 0 && now - last > STALL_THRESHOLD_MS;
}

const ATTENTION = new Set(['paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'failed', 'interrupted']);
const PAUSE_REASON_TEXT = {
  user_pause: 'Paused by you.',
  schedule_preempt: 'Paused while a scheduled run used the agent.',
  error: 'Paused after an error.',
  max_steps: 'Paused after reaching the step limit.',
  interrupted: 'Interrupted (for example by a restart).',
};

/** Why the task stopped / what it needs, in Prometheus' own words. Empty when nothing to show. */
export function attentionText(task) {
  const raw = str(task?.status).toLowerCase();
  if (!ATTENTION.has(raw) && !ATTENTION.has(normalizeStatus(raw))) return '';
  const pick = (value) => oneLine(value);
  const turns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation : [];
  let recovery = '';
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i]?.role === 'assistant' && str(turns[i]?.content).trim()) { recovery = turns[i].content; break; }
  const text = pick(task?.pendingClarificationQuestion)
    || pick(task?.pauseAnalysis?.message)
    || pick(task?.attentionMessage)
    || pick(recovery)
    || (raw === 'failed' ? pick(task?.lastError || task?.finalSummary) : '')
    || pick(PAUSE_REASON_TEXT[str(task?.pauseReason)] || '')
    || (raw === 'interrupted' ? 'The chat run was interrupted before it finished.' : '');
  return cap(text, 320);
}

function initials(name) {
  const parts = oneLine(name).split(/[\s·_-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '•';
}

/** {actor, initials, kind} for the card header. */
export function actorLabel(task) {
  const kind = taskKind(task);
  const agent = oneLine(task?.teamSubagent?.agentName || task?.proposalExecutorAgentName || task?.agentName || '');
  const team = oneLine(task?.teamName || '');
  let actor;
  if (kind === 'plan') actor = 'Prometheus plan';
  else if (kind === 'brain') actor = task?.brainJob === 'thought' ? 'Brain thought' : task?.brainJob === 'dream_cleanup' ? 'Brain dream cleanup' : 'Brain dream';
  else if (kind === 'scheduled') actor = `Scheduled · ${agent || oneLine(task?.title) || 'job'}`;
  else if (kind === 'team' || kind === 'subagent') actor = [agent || oneLine(task?.subagentProfile) || 'Agent', team].filter(Boolean).join(' · ');
  else actor = 'Background task';
  const avatarSource = kind === 'plan' ? 'P' : kind === 'scheduled' ? (agent || 'S') : kind === 'background' ? 'B' : kind === 'brain' ? 'Br' : agent || actor;
  return { actor: cap(actor, 80), initials: kind === 'plan' ? 'P' : kind === 'background' ? 'BG' : initials(avatarSource).slice(0, 2), kind };
}

/**
 * Avatar provider for the card: the server-resolved modelRef (actual run model,
 * else configured route). logoKey '' means unknown -> renderers fall back to initials.
 */
export function taskAvatar(task) {
  const ref = task?.modelRef && typeof task.modelRef === 'object' ? task.modelRef : null;
  const providerId = oneLine(ref?.providerId);
  const model = oneLine(ref?.model);
  const logoKey = providerId || model ? providerLogoKey(providerId, model) : '';
  const reasoningEffort = oneLine(ref?.reasoningEffort);
  return { providerId, model, logoKey, reasoningEffort, modelSource: oneLine(ref?.source) };
}

/** "Opus 5.5 · Medium" for the card's sub line; falls back to the source kind when the model is unknown. */
export function taskModelLabel(task) {
  const { providerId, model, reasoningEffort } = taskAvatar(task);
  return oneLine(agentModelLabel({ providerId, model, reasoningEffort })) || sourceLabel(task);
}

export function sourceLabel(task) {
  const kind = taskKind(task);
  if (kind === 'plan') return 'chat';
  if (kind === 'scheduled') return 'schedule';
  if (kind === 'team') return 'team dispatch';
  return oneLine(task?.channel || task?.source || 'task').toLowerCase();
}

export function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 && m < 10 ? ` ${s % 60}s` : ''}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(h / 24)}d`;
}

export function relTime(ts, now = Date.now()) {
  const t = Number(ts) || Date.parse(str(ts)) || 0;
  if (!t) return '';
  const diff = now - t;
  if (diff < 45_000) return 'just now';
  return `${formatDuration(diff).split(' ')[0]} ago`;
}

/** Name of the tool currently running (planned runs: lastToolCall; tasks: newest journal tool_call). */
export function liveToolName(task) {
  if (normalizeStatus(task?.status) !== 'running') return '';
  if (task?.lastToolCall?.name) return oneLine(task.lastToolCall.name);
  const activity = Array.isArray(task?.activity) ? task.activity : [];
  if (activity.length) return oneLine(activity[activity.length - 1]?.name);
  const journal = Array.isArray(task?.journal) ? task.journal : [];
  for (let i = journal.length - 1; i >= 0; i--) {
    if (journal[i]?.type === 'tool_call') return oneLine(str(journal[i].content).split(/[\s(:]/)[0]);
  }
  return '';
}

/** Card model shared by both clients. */
export function buildTaskCard(task, now = Date.now()) {
  const actor = actorLabel(task);
  const progress = progressSummary(task);
  const status = normalizeStatus(task?.status);
  const stalled = isLikelyStalled(task, now);
  const startedAt = Number(task?.startedAt || task?.createdAt) || 0;
  return {
    id: str(task?.id),
    kind: actor.kind,
    actor: actor.actor,
    initials: actor.initials,
    avatar: taskAvatar(task),
    sub: [startedAt ? `started ${relTime(startedAt, now)}` : '', taskModelLabel(task)].filter(Boolean).join(' · '),
    title: cleanTaskTitle(task),
    status,
    statusLabel: stalled ? 'Stalled?' : statusLabel(task?.status),
    tone: stalled ? 'warn' : statusTone(task?.status),
    progress,
    tool: liveToolName(task),
    stalledFor: stalled ? formatDuration(now - lastProgressAt(task)) : '',
    attention: attentionText(task),
    terminal: isTerminalStatus(task?.status),
    planned: actor.kind === 'plan',
  };
}

const NOISE = /^(?:processing|thinking|working|still working|running|heartbeat|continuing|status(?: update)?|progress)\b[\s.…:!-]*$/i;

function activityRows(task) {
  const activity = Array.isArray(task?.activity) ? task.activity : [];
  if (activity.length) {
    return activity.map(entry => ({
      t: Number(entry?.t) || 0,
      kind: entry?.kind === 'tool' ? 'tool_call' : entry?.kind === 'error' ? 'error' : 'tool_result',
      name: oneLine(entry?.name), text: oneLine(entry?.detail),
    }));
  }
  const journal = Array.isArray(task?.journal) ? task.journal : [];
  return journal.map(entry => {
    const type = str(entry?.type);
    const content = oneLine(entry?.content);
    const name = type === 'tool_call' || type === 'tool_result' ? oneLine(content.split(/[\s(:]/)[0]) : '';
    return { t: Number(entry?.t || entry?.timestamp) || 0, kind: type || 'status', name, text: content, detail: str(entry?.detail) };
  });
}

/**
 * Activity rows with tool call + result paired, errors flagged, and noise collapsed.
 * Returns [{type:'tool'|'error'|'status'|'hidden', ...}]; `hidden` groups carry `count` and `rows`.
 */
export function collapseActivity(taskOrRows) {
  const rows = Array.isArray(taskOrRows) ? taskOrRows : activityRows(taskOrRows);
  const out = [];
  let hidden = null;
  const statusItem = (row) => { const kind = str(row?.kind); return { type: kind === 'tool_result' ? 'tool' : 'status', t: row.t, name: row.name, text: row.text, call: '', result: kind === 'tool_result' ? row.text : '', detail: row.detail }; };
  // A run of 2+ folded rows becomes one "Hiding N" group; a lone folded row renders inline as a normal row.
  const flushHidden = () => { if (!hidden) return; if (hidden.count === 1 && oneLine(hidden.rows[0]?.text)) out.push(statusItem(hidden.rows[0])); else out.push(hidden); hidden = null; };
  let lastStatus = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const kind = str(row?.kind);
    const isError = kind === 'error' || /\b(?:error|failed|exception)\b/i.test(kind) || row?.isError === true;
    if (kind === 'tool_call') {
      const next = rows[i + 1];
      const nextKind = str(next?.kind);
      const paired = next && (nextKind === 'tool_result' || nextKind === 'error') && (!row.name || !next.name || next.name === row.name);
      flushHidden(); lastStatus = '';
      out.push({ type: 'tool', t: row.t, name: row.name || 'tool', call: row.text, result: paired ? next.text : '', error: paired && nextKind === 'error', pending: !paired });
      if (paired) i++;
      continue;
    }
    if (isError) { flushHidden(); lastStatus = ''; out.push({ type: 'error', t: row.t, name: row.name, text: row.text, detail: row.detail }); continue; }
    const key = oneLine(row?.text).toLowerCase();
    if (!key || NOISE.test(key) || key === lastStatus) {
      if (!hidden) hidden = { type: 'hidden', count: 0, rows: [] };
      hidden.count++; hidden.rows.push(row);
      continue;
    }
    flushHidden(); lastStatus = key;
    out.push(statusItem(row));
  }
  flushHidden();
  return out;
}

/** Overview/Activity/Evidence description for the detail view. */
export function detailSections(task, extra = {}) {
  const card = buildTaskCard(task, extra.now);
  const status = normalizeStatus(task?.status);
  return {
    card,
    attention: attentionText(task),
    result: status === 'complete' || status === 'failed' ? str(task?.finalSummary).trim() : '',
    startedFrom: dispatchedMessage(task),
    rawInstructions: rawInstructions(task),
    progress: card.progress,
    activity: collapseActivity(task),
    evidence: Array.isArray(extra.evidence) ? extra.evidence : Array.isArray(task?.evidenceBus?.entries) ? task.evidenceBus.entries : [],
    artifacts: Array.isArray(task?.artifacts) ? task.artifacts : [],
    // Failed/paused/stalled/needs-you/running tasks stay messageable (recovery chat); complete/cancelled and planned chats do not.
    canMessage: !card.planned && !['complete', 'cancelled'].includes(status),
    openChat: card.planned,
  };
}
