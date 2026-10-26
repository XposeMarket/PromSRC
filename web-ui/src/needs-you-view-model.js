// Shared, pure view-model for the Tasks page "Needs You" column (desktop) and
// tab (mobile). No DOM, no browser-only imports: safe to import from plain Node.
// HTML escaping stays in the renderers, not here.

// Item ids are namespaced by the aggregator ("approval:<id>", "task:<id>"); the
// resolve endpoints need the raw store id, which lives on payload.id.
export const NY_KIND_LABEL = {
  final_action_approval: 'Final action',
  tool_approval: 'Tool approval',
  question: 'Question',
  browser_login: 'Login needed',
  dev_source_edit_proposal: 'Source edit proposal',
  needs_user_supervision: 'Thread blocked',
  team_escalation: 'Team needs you',
  paused_agent_run: 'Paused agent run',
  video_approval: 'Paid video run',
};

export const NY_PAUSE_REASON = {
  error: 'Stopped on an error',
  awaiting_user_input: 'Waiting for your reply',
  awaiting_approval: 'Waiting for an approval',
  awaiting_command_approval: 'Waiting for command approval',
  awaiting_final_action_approval: 'Waiting for final-action approval',
  awaiting_prometheus_question_response: 'Waiting for a question answer',
};

const NEEDS_YOU_TASK_STATUSES = new Set(['needs_assistance', 'awaiting_user_input']);

// Agent prompts open with [SUBAGENT]/IDENTITY/WORKSPACE RULES boilerplate.
// Show the actual task line instead, collapsed to one short paragraph.
export function needsYouSummary(payload = {}) {
  const raw = String(payload.content || payload.reason || payload.prompt || payload.toolName || payload.title || payload.targetTitle || '');
  const task = raw.match(/\b(?:YOUR TASK|TASK|ASSIGNMENT|GOAL|OBJECTIVE)\s*:\s*([\s\S]+)/)?.[1]
    || raw.replace(/^\s*\[[^\]]+\]\s*/, '')
      .split(/\n\s*\n|(?=\b(?:IDENTITY|WORKSPACE RULES|CONTEXT|CONSTRAINTS)\s*:)/)
      .find((block) => block.trim().length > 12 && !/^\s*(IDENTITY|WORKSPACE RULES|RULES|CONTEXT|CONSTRAINTS)\s*:/.test(block))
    || '';
  const text = task.replace(/\s+/g, ' ').trim() || 'Waiting for your input.';
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

export function nyRawId(item) {
  const fromPayload = String(item?.payload?.id || '').trim();
  if (fromPayload) return fromPayload;
  return String(item?.id || '').replace(/^[a-z-]+:/i, '');
}

export function nyRelTime(value) {
  const t = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(t) || t <= 0) return '';
  const diff = Date.now() - t;
  const s = Math.abs(diff) / 1000;
  const label = s < 60 ? `${Math.max(1, Math.round(s))}s`
    : s < 3600 ? `${Math.round(s / 60)}m`
      : s < 86400 ? `${Math.round(s / 3600)}h`
        : `${Math.round(s / 86400)}d`;
  return diff < 0 ? `in ${label}` : `${label} ago`;
}

export const nyCap = (s) => {
  const v = String(s || '').trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
};

/** Headline + labelled facts so the card says what will happen without opening the thread. */
export function needsYouDetails(item = {}) {
  const kind = String(item.kind || '');
  const p = item.payload || {};
  const rows = [];
  let headline = '';
  const push = (label, value) => { const v = String(value ?? '').trim(); if (v) rows.push([label, v]); };
  if (kind === 'final_action_approval' || kind === 'tool_approval') {
    const fa = p.finalAction || {};
    const args = p.toolArgs && typeof p.toolArgs === 'object' ? p.toolArgs : {};
    const actionKind = String(fa.actionKind || args.action_kind || '').trim();
    const surface = String(fa.surface || args.surface || (Array.isArray(p.affectedSystems) ? p.affectedSystems[0] : '') || '').trim();
    if (kind === 'final_action_approval') {
      headline = actionKind ? `${nyCap(actionKind)}${surface ? ` on ${surface}` : ''}` : 'Approve final action';
      push('Button', fa.targetLabel || args.target_label);
      push('Next step', fa.nextToolName || args.next_tool_name);
    } else {
      headline = String(p.action || '').trim() || `Run ${String(p.toolName || 'tool').replace(/_/g, ' ')}`;
      push('Tool', p.toolName);
      push('Command', args.command);
      push('Path', args.path || args.filename || p.pathAccess?.requestedPath);
      push('Directory', args.cwd);
      if (!actionKind) push('Where', surface);
    }
    if (p.riskScore != null && p.riskScore !== '') push('Risk', `${p.riskScore}/10${p.policyTier ? ` · ${p.policyTier}` : ''}`);
    push('Requested', nyRelTime(p.createdAt || item.createdAt));
    const exp = Number(fa.expiresAt || p.expiresAt || 0);
    if (exp > Date.now()) push('Expires', nyRelTime(exp));
  } else if (kind === 'paused_agent_run') {
    const status = String(p.pauseReason || p.status || '').toLowerCase();
    headline = NY_PAUSE_REASON[status] || nyCap(String(p.status || 'paused').replace(/_/g, ' '));
    const plan = Array.isArray(p.plan) ? p.plan : [];
    const idx = Number(p.currentStepIndex);
    const step = Number.isFinite(idx) && plan[idx] ? String(plan[idx].description || plan[idx].title || plan[idx].text || '') : '';
    if (plan.length) push('Step', `${Math.min(plan.length, (Number.isFinite(idx) ? idx : 0) + 1)} of ${plan.length}${step ? `: ${step.slice(0, 90)}` : ''}`);
    const items = Array.isArray(p.runtimeProgress?.items) ? p.runtimeProgress.items : [];
    if (items.length) push('Progress', `${items.filter((x) => x?.status === 'done').length}/${items.length} tool steps done`);
    push('Model', p.executorProvider);
    push('Last activity', nyRelTime(p.lastProgressAt));
    push('Started', nyRelTime(p.startedAt || item.createdAt));
  } else {
    push('Requested', nyRelTime(item.createdAt));
  }
  return { headline, rows };
}

function itemTime(item) {
  const t = typeof item?.createdAt === 'number' ? item.createdAt : Date.parse(String(item?.createdAt || ''));
  return Number.isFinite(t) ? t : 0;
}

/** Raw task ids that /api/needs-you says are waiting on the user (kind paused_agent_run). */
export function needsYouTaskIds(items) {
  const ids = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind !== 'paused_agent_run') continue;
    const id = nyRawId(item);
    if (id) ids.add(String(id));
  }
  return ids;
}

/** Non-task needs-you items as card view-models. paused_agent_run items are excluded (rendered as task cards). */
export function needsYouEntries(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((item) => item && item.kind !== 'paused_agent_run')
    .map((item) => {
      const kind = String(item.kind || '');
      const payload = item.payload || {};
      const details = needsYouDetails(item);
      const kindLabel = NY_KIND_LABEL[kind] || nyCap(kind.replace(/_/g, ' '));
      const isApproval = kind === 'tool_approval' || kind === 'final_action_approval';
      const summary = isApproval
        ? String(payload.finalAction?.summary || payload.reason || needsYouSummary(payload))
        : needsYouSummary(payload);
      return {
        id: String(item.id || ''),
        rawId: nyRawId(item),
        kind,
        kindLabel,
        title: details.headline || kindLabel,
        summary,
        source: String(item.source || 'Chat'),
        sessionId: String(item.sessionId || ''),
        createdAt: item.createdAt,
        facts: details.rows,
        item,
      };
    })
    .sort((a, b) => itemTime(b.item) - itemTime(a.item));
}

/** True when the task belongs in the Needs You column/tab. */
export function isNeedsYouTask(task, taskIdSet) {
  if (!task) return false;
  const status = String(task.status || '').trim().toLowerCase();
  if (NEEDS_YOU_TASK_STATUSES.has(status)) return true;
  return Boolean(taskIdSet && taskIdSet.has(String(task.id)));
}

/** Badge count for the tab/column header: entries + needs-you tasks (no double count). */
export function needsYouCount(tasks, items) {
  const ids = needsYouTaskIds(items);
  // Count unique task ids: one task can appear as both a needs_assistance row and a paused_agent_run item.
  const taskIds = new Set();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (isNeedsYouTask(t, ids)) taskIds.add(String(t.id));
  }
  return needsYouEntries(items).length + taskIds.size;
}
