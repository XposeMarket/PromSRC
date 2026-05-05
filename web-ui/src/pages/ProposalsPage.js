/**
 * ProposalsPage.js - F3b Extract
 *
 * Proposals page: loads, renders, approves/denies proposals, badge management.
 *
 * Functions extracted from index.html:
 *   loadProposals, renderProposals, updateProposalBadge,
 *   jumpToProposalSession, jumpToProposalTask,
 *   approveProposal, denyProposal, checkPendingProposalsBadge
 *
 * Dependencies: escHtml, showToast from utils.js
 * Cross-page: chatSessions, setMode, openSession, openBgtPanel
 */

import { api } from '../api.js';
import { escHtml, showToast } from '../utils.js';
import { state } from '../state.js';

const DEFAULT_FILTER = 'pending';
const EMPTY_MESSAGES = {
  pending: 'No pending proposals',
  approved: 'No approved proposals',
  in_progress: 'No in progress proposals',
  paused: 'No paused proposals',
  denied: 'No denied proposals',
  executed: 'No executed proposals',
  all: 'No proposals yet',
};

const TASK_STATUS_PRESENTATION = {
  running: { label: 'in progress', color: '#0d4faf', icon: '&#9679;' },
  queued: { label: 'queued', color: '#7c4d00', icon: '&#9717;' },
  waiting_subagent: { label: 'in progress', color: '#0d4faf', icon: '&#9679;' },
  paused: { label: 'paused', color: '#555', icon: '&#10074;&#10074;' },
  stalled: { label: 'stalled', color: '#9c1a1a', icon: '&#9650;' },
  needs_assistance: { label: 'needs you', color: '#6d2d9e', icon: '&#9888;' },
  awaiting_user_input: { label: 'needs you', color: '#6d2d9e', icon: '&#9888;' },
};

function getProposalFilterValue() {
  const filterEl = document.getElementById('proposals-filter');
  const value = typeof filterEl?.value === 'string' ? filterEl.value.trim() : '';
  return value || DEFAULT_FILTER;
}

function getEmptyMessage(filter) {
  return EMPTY_MESSAGES[filter] || 'No proposals found';
}

function getDisplayStatus(proposal, statusColor, statusIcon) {
  const proposalStatus = String(proposal?.status || '').trim().toLowerCase();
  if (proposalStatus === 'executing' || proposalStatus === 'repairing') {
    const taskStatus = String(proposal?.taskStatus || '').trim().toLowerCase();
    const taskPresentation = TASK_STATUS_PRESENTATION[taskStatus];
    if (taskPresentation) {
      return {
        key: taskStatus,
        label: taskPresentation.label,
        color: taskPresentation.color,
        icon: taskPresentation.icon,
      };
    }
  }
  return {
    key: proposalStatus,
    label: proposalStatus || 'unknown',
    color: statusColor[proposalStatus] || 'var(--muted)',
    icon: statusIcon[proposalStatus] || '',
  };
}

export async function loadProposals() {
  const list = document.getElementById('proposals-list');
  if (!list) return;
  const filter = getProposalFilterValue();
  list.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px 0">Loading...</div>';
  try {
    const data = await api(`/api/proposals?status=${encodeURIComponent(filter)}`);
    if (!data.success) throw new Error(data.error || 'Failed to load proposals');
    renderProposals(Array.isArray(data.proposals) ? data.proposals : [], filter);
  } catch (e) {
    list.innerHTML = `<div style="color:var(--error,#e05c5c);font-size:13px;text-align:center;padding:40px 0">Failed to load proposals: ${e.message}</div>`;
  }
}

function renderProposals(proposals, filter = getProposalFilterValue()) {
  const list = document.getElementById('proposals-list');
  if (!list) return;

  updateProposalBadge(proposals);

  if (!Array.isArray(proposals) || proposals.length === 0) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px 0">${getEmptyMessage(filter)}</div>`;
    return;
  }

  const priorityColor = { critical: '#e05c5c', high: '#e08b3a', medium: '#6c8ebf', low: 'var(--muted)' };
  const statusColor = { pending: '#e08b3a', approved: '#3aaa6b', denied: '#e05c5c', executing: '#6c8ebf', repairing: '#6d2d9e', executed: '#3aaa6b', failed: '#e05c5c', expired: 'var(--muted)' };
  const statusIcon = { pending: '&#9203;', approved: '&#10003;', denied: '&#10005;', executing: '&#9881;', repairing: '&#9888;', executed: '&#10003;', failed: '&#10005;', expired: '&#128465;' };

  list.innerHTML = proposals.map((proposal) => {
    const isPending = proposal.status === 'pending';
    const isExecuting = proposal.status === 'executing' || proposal.status === 'repairing';
    const isExecuted = proposal.status === 'executed';
    const isFailed = proposal.status === 'failed';
    const priorityBadgeColor = priorityColor[proposal.priority] || 'var(--muted)';
    const created = new Date(proposal.createdAt).toLocaleString();
    const decided = proposal.decidedAt ? new Date(proposal.decidedAt).toLocaleString() : null;
    const proposalSessionId = `proposal_${proposal.id}`;
    const displayStatus = getDisplayStatus(proposal, statusColor, statusIcon);
    const files = Array.isArray(proposal.affectedFiles)
      ? proposal.affectedFiles.map((file) =>
        `<span style="font-size:10px;background:var(--panel-2);padding:2px 6px;border-radius:4px;font-family:monospace;border:1px solid var(--line)">${escHtml(file.action)}: ${escHtml(file.path)}</span>`,
      ).join(' ')
      : '';
    const resultText = String(proposal.executionResult || '');
    const borderAccent = isPending
      ? 'var(--brand)'
      : displayStatus.key === 'paused'
        ? '#555'
        : displayStatus.key === 'needs_assistance' || displayStatus.key === 'awaiting_user_input'
          ? '#6d2d9e'
          : displayStatus.key === 'stalled'
            ? '#9c1a1a'
            : isExecuting
              ? '#6c8ebf'
        : isExecuted
          ? '#3aaa6b'
          : isFailed
            ? '#e05c5c'
            : 'var(--line)';
    const executingSpinner = isExecuting && (displayStatus.key === 'executing' || displayStatus.key === 'in_progress' || displayStatus.key === 'running')
      ? '<span class="thinking-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6c8ebf;margin-left:4px"></span>'
      : '';

    return `<div style="border:1px solid ${borderAccent};border-radius:10px;padding:14px 16px;background:var(--panel);margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:700;color:var(--fg)">${escHtml(proposal.title)}</span>
            <span style="font-size:10px;font-weight:700;color:${priorityBadgeColor};text-transform:uppercase;padding:1px 5px;border-radius:3px;border:1px solid ${priorityBadgeColor}">${escHtml(proposal.priority)}</span>
            <span style="font-size:10px;font-weight:700;color:${displayStatus.color};text-transform:uppercase">${displayStatus.icon} ${escHtml(displayStatus.label)}${executingSpinner}</span>
            <span style="font-size:10px;color:var(--muted)">${escHtml(proposal.type)}</span>
          </div>
          <div style="font-size:12px;color:var(--fg);margin-bottom:6px;opacity:0.8">${escHtml(proposal.summary)}</div>
          ${files ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${files}</div>` : ''}
          ${proposal.estimatedImpact ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Impact: ${escHtml(proposal.estimatedImpact)}</div>` : ''}
          ${resultText && (isExecuted || isFailed) ? `<div style="font-size:11px;padding:6px 8px;border-radius:6px;background:${isFailed ? 'rgba(224,92,92,0.1)' : 'rgba(58,170,107,0.1)'};border:1px solid ${isFailed ? '#e05c5c44' : '#3aaa6b44'};margin-bottom:6px;color:var(--fg)">${escHtml(resultText.slice(0, 200))}${resultText.length > 200 ? '...' : ''}</div>` : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:4px">
            Submitted: ${created}
            ${decided ? ` &bull; Decided: ${decided}` : ''}
            ${proposal.executorAgentId ? ` &bull; Executor: ${escHtml(proposal.executorAgentId)}` : ''}
          </div>
          ${proposal.requiresBuild ? '<div style="font-size:10px;color:#e08b3a;margin-top:2px">Requires build</div>' : ''}
          ${proposal.executorTaskId && isExecuting ? `<div style="font-size:10px;color:${displayStatus.color};margin-top:4px">Task: <code style="font-family:monospace">${escHtml(proposal.executorTaskId)}</code>${displayStatus.label ? ` &bull; ${escHtml(displayStatus.label)}` : ''}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          ${isPending ? `
            <button onclick="approveProposal('${proposal.id}')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#3aaa6b;color:#fff;cursor:pointer">Approve</button>
            <button onclick="denyProposal('${proposal.id}')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#e05c5c;color:#fff;cursor:pointer">Deny</button>
          ` : ''}
          ${isExecuting && proposal.executorTaskId ? `<button onclick="jumpToProposalTask('${proposal.executorTaskId}')" style="padding:5px 10px;font-size:11px;font-weight:600;border:1px solid #6c8ebf;border-radius:6px;background:transparent;color:#6c8ebf;cursor:pointer">View Task</button>` : ''}
          ${(isExecuted || isFailed) ? `<button onclick="jumpToProposalSession('${proposalSessionId}')" style="padding:5px 10px;font-size:11px;font-weight:600;border:1px solid var(--brand);border-radius:6px;background:transparent;color:var(--brand);cursor:pointer">View Session</button>` : ''}
        </div>
      </div>
      <details style="margin-top:8px"><summary style="font-size:11px;color:var(--muted);cursor:pointer;user-select:none">View details &amp; plan</summary>
        <div class="markdown-body proposal-detail-body" style="font-size:12px;margin-top:8px;padding:10px 12px;background:var(--panel-2);border-radius:6px;overflow:auto;max-height:400px">${(typeof marked !== 'undefined' ? marked.parse(proposal.details || proposal.summary || '', { breaks: true, gfm: true, mangle: false, headerIds: false }) : `<pre style='white-space:pre-wrap'>${escHtml(proposal.details || proposal.summary || '')}</pre>`)}</div>
        ${proposal.diffPreview ? `<pre style="font-size:10px;color:var(--fg);white-space:pre-wrap;margin-top:6px;padding:8px 10px;background:var(--panel-2);border-radius:6px;border:1px solid var(--line);overflow:auto;max-height:240px;font-family:'IBM Plex Mono',monospace;line-height:1.5">${escHtml(proposal.diffPreview)}</pre>` : ''}
      </details>
    </div>`;
  }).join('');
}

export function updateProposalBadge(proposals) {
  const badge = document.getElementById('proposals-badge');
  if (!badge) return;
  const pending = Array.isArray(proposals)
    ? proposals.filter((proposal) => proposal.status === 'pending').length
    : 0;
  if (pending > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = pending > 9 ? '9+' : String(pending);
  } else {
    if (state.currentMode !== 'proposals') return;
    badge.style.display = 'none';
  }
}

export function jumpToProposalSession(sessionId) {
  const sessions = window.chatSessions || state.chatSessions || [];
  const session = sessions.find((item) => item.id === sessionId);
  if (session) {
    if (typeof window.setMode === 'function') window.setMode('chat');
    if (typeof window.openSession === 'function') window.openSession(sessionId);
  } else {
    showToast('Session not found - it may still be running.');
  }
}

export async function jumpToProposalTask(taskId) {
  if (!taskId) {
    showToast('Task not found.');
    return;
  }
  if (typeof window.setMode === 'function') window.setMode('bgtasks');
  if (typeof window.openBgtPanel === 'function') {
    await window.openBgtPanel(taskId);
    return;
  }
  showToast('Task panel is not available right now.');
}

export async function approveProposal(id) {
  try {
    const data = await api(`/api/proposals/${id}/approve`, {
      method: 'POST',
      body: '{}',
    });
    if (!data.success) throw new Error(data.error);
    if (data.dispatched && data.taskId) {
      showToast('Proposal approved', `Executor task ${data.taskId} started`, 'success');
    } else if (data.dispatched) {
      showToast('Proposal approved - executor started', '', 'success');
    } else {
      showToast('Proposal approved', 'No executor plan was attached.', 'warning');
    }
    loadProposals();
  } catch (e) {
    showToast(`Error: ${e.message}`, '', 'error');
  }
}

export async function denyProposal(id) {
  try {
    const data = await api(`/api/proposals/${id}/deny`, {
      method: 'POST',
      body: '{}',
    });
    if (!data.success) throw new Error(data.error);
    showToast('Proposal denied');
    loadProposals();
  } catch (e) {
    showToast(`Error: ${e.message}`, '', 'error');
  }
}

export async function checkPendingProposalsBadge() {
  try {
    const data = await api('/api/proposals?status=pending');
    if (data.success) updateProposalBadge(data.proposals || []);
  } catch {
    // Non-fatal badge refresh error.
  }
}

window.loadProposals = loadProposals;
window.approveProposal = approveProposal;
window.denyProposal = denyProposal;
window.jumpToProposalSession = jumpToProposalSession;
window.jumpToProposalTask = jumpToProposalTask;
window.updateProposalBadge = updateProposalBadge;
window.checkPendingProposalsBadge = checkPendingProposalsBadge;
