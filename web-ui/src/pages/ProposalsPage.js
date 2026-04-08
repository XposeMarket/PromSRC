/**
 * ProposalsPage.js — F3b Extract
 *
 * Proposals page: loads, renders, approves/denies proposals, badge management.
 *
 * Functions extracted verbatim from index.html:
 *   loadProposals, renderProposals, updateProposalBadge,
 *   jumpToProposalSession, approveProposal, denyProposal,
 *   checkPendingProposalsBadge
 *
 * Dependencies: escHtml, showToast from utils.js
 * Cross-page: chatSessions, setMode, openSession (accessed via window.* during migration)
 */

import { escHtml, showToast } from '../utils.js';
import { state } from '../state.js';

// ─── Functions ─────────────────────────────────────────────────

export async function loadProposals() {
  const list = document.getElementById('proposals-list');
  if (!list) return;
  const filter = document.getElementById('proposals-filter')?.value || 'pending';
  list.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px 0">Loading...</div>';
  try {
    const url = filter ? `/api/proposals?status=${encodeURIComponent(filter)}` : '/api/proposals';
    const r = await fetch(url);
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    renderProposals(data.proposals || []);
  } catch (e) {
    list.innerHTML = `<div style="color:var(--error,#e05c5c);font-size:13px;text-align:center;padding:40px 0">Failed to load proposals: ${e.message}</div>`;
  }
}

function renderProposals(proposals) {
  const list = document.getElementById('proposals-list');
  if (!list) return;

  updateProposalBadge(proposals);

  if (!proposals.length) {
    const filter = document.getElementById('proposals-filter')?.value || 'pending';
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px 0">No ${filter} proposals</div>`;
    return;
  }
  const priorityColor = { critical: '#e05c5c', high: '#e08b3a', medium: '#6c8ebf', low: 'var(--muted)' };
  const statusColor = { pending: '#e08b3a', approved: '#3aaa6b', denied: '#e05c5c', executing: '#6c8ebf', executed: '#3aaa6b', failed: '#e05c5c', expired: 'var(--muted)' };
  const statusIcon = { pending: '⏳', approved: '✅', denied: '❌', executing: '⚙️', executed: '✅', failed: '❌', expired: '🗑' };
  list.innerHTML = proposals.map(p => {
    const isPending = p.status === 'pending';
    const isExecuting = p.status === 'executing';
    const isExecuted = p.status === 'executed';
    const isFailed = p.status === 'failed';
    const pColor = priorityColor[p.priority] || 'var(--muted)';
    const sColor = statusColor[p.status] || 'var(--muted)';
    const sIcon = statusIcon[p.status] || '';
    const created = new Date(p.createdAt).toLocaleString();
    const decided = p.decidedAt ? new Date(p.decidedAt).toLocaleString() : null;
    const files = (p.affectedFiles || []).map(f =>
      `<span style="font-size:10px;background:var(--bg-soft,#f0f0f0);padding:2px 6px;border-radius:4px;font-family:monospace;border:1px solid var(--line)">${f.action}: ${escHtml(f.path)}</span>`
    ).join(' ');
    const borderAccent = isPending ? 'var(--brand)' : isExecuting ? '#6c8ebf' : isExecuted ? '#3aaa6b' : isFailed ? '#e05c5c' : 'var(--line)';
    const executingSpinner = isExecuting ? '<span class="thinking-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6c8ebf;margin-left:4px"></span>' : '';
    return `<div style="border:1px solid ${borderAccent};border-radius:10px;padding:14px 16px;background:var(--panel);margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:700;color:var(--fg)">${escHtml(p.title)}</span>
            <span style="font-size:10px;font-weight:700;color:${pColor};text-transform:uppercase;padding:1px 5px;border-radius:3px;border:1px solid ${pColor}">${p.priority}</span>
            <span style="font-size:10px;font-weight:700;color:${sColor};text-transform:uppercase">${sIcon} ${p.status}${executingSpinner}</span>
            <span style="font-size:10px;color:var(--muted)">${escHtml(p.type)}</span>
          </div>
          <div style="font-size:12px;color:var(--fg);margin-bottom:6px;opacity:0.8">${escHtml(p.summary)}</div>
          ${files ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${files}</div>` : ''}
          ${p.estimatedImpact ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Impact: ${escHtml(p.estimatedImpact)}</div>` : ''}
          ${p.executionResult && (isExecuted || isFailed) ? `<div style="font-size:11px;padding:6px 8px;border-radius:6px;background:${isFailed ? 'rgba(224,92,92,0.1)' : 'rgba(58,170,107,0.1)'};border:1px solid ${isFailed ? '#e05c5c44' : '#3aaa6b44'};margin-bottom:6px;color:var(--fg)">${escHtml(p.executionResult.slice(0, 200))}${p.executionResult.length > 200 ? '...' : ''}</div>` : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:4px">
            Submitted: ${created}
            ${decided ? ` &bull; Decided: ${decided}` : ''}
            ${p.executorAgentId ? ` &bull; Executor: ${escHtml(p.executorAgentId)}` : ''}
          </div>
          ${p.requiresBuild ? '<div style="font-size:10px;color:#e08b3a;margin-top:2px">⚠ Requires build</div>' : ''}
          ${p.executorTaskId && isExecuting ? `<div style="font-size:10px;color:#6c8ebf;margin-top:4px">⚙️ Running in session: <code style="font-family:monospace">${escHtml(p.executorTaskId)}</code></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          ${isPending ? `
            <button onclick="approveProposal('${p.id}')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#3aaa6b;color:#fff;cursor:pointer">✓ Approve</button>
            <button onclick="denyProposal('${p.id}')" style="padding:6px 14px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#e05c5c;color:#fff;cursor:pointer">✗ Deny</button>
          ` : ''}
          ${isExecuted && p.executorTaskId ? `<button onclick="jumpToProposalSession('${p.executorTaskId}')" style="padding:5px 10px;font-size:11px;font-weight:600;border:1px solid var(--brand);border-radius:6px;background:transparent;color:var(--brand);cursor:pointer">View Session</button>` : ''}
        </div>
      </div>
      <details style="margin-top:8px"><summary style="font-size:11px;color:var(--muted);cursor:pointer;user-select:none">View details &amp; plan</summary>
        <div class="markdown-body proposal-detail-body" style="font-size:12px;margin-top:8px;padding:10px 12px;background:var(--bg-soft,#f5f5f5);border-radius:6px;overflow:auto;max-height:400px">${(typeof marked !== 'undefined' ? marked.parse(p.details || p.summary || '', { breaks: true, gfm: true, mangle: false, headerIds: false }) : `<pre style='white-space:pre-wrap'>${escHtml(p.details || p.summary)}</pre>`)}</div>
        ${p.diffPreview ? `<pre style="font-size:10px;color:var(--fg);white-space:pre-wrap;margin-top:6px;padding:8px 10px;background:var(--bg-soft,#f5f5f5);border-radius:6px;border:1px solid var(--line);overflow:auto;max-height:240px;font-family:'IBM Plex Mono',monospace;line-height:1.5">${escHtml(p.diffPreview)}</pre>` : ''}
      </details>
    </div>`;
  }).join('');
}

export function updateProposalBadge(proposals) {
  const badge = document.getElementById('proposals-badge');
  if (!badge) return;
  const pending = Array.isArray(proposals)
    ? proposals.filter(p => p.status === 'pending').length
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
  // Cross-page: uses chatSessions, setMode, openSession from window.*
  const sess = (window.chatSessions || state.chatSessions || []).find(s => s.id === sessionId);
  if (sess) {
    window.setMode('chat');
    window.openSession(sessionId);
  } else {
    showToast('Session not found — it may still be running.');
  }
}

export async function approveProposal(id) {
  try {
    const r = await fetch(`/api/proposals/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    showToast('Proposal approved — dispatching executor...');
    loadProposals();
  } catch (e) { showToast('Error: ' + e.message, '', 'error'); }
}

export async function denyProposal(id) {
  try {
    const r = await fetch(`/api/proposals/${id}/deny`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    showToast('Proposal denied');
    loadProposals();
  } catch (e) { showToast('Error: ' + e.message, '', 'error'); }
}

export async function checkPendingProposalsBadge() {
  try {
    const r = await fetch('/api/proposals?status=pending');
    const data = await r.json();
    if (data.success) updateProposalBadge(data.proposals || []);
  } catch { /* non-fatal */ }
}

// ─── Expose on window for HTML onclick handlers ────────────────
window.loadProposals = loadProposals;
window.approveProposal = approveProposal;
window.denyProposal = denyProposal;
window.jumpToProposalSession = jumpToProposalSession;
window.updateProposalBadge = updateProposalBadge;
window.checkPendingProposalsBadge = checkPendingProposalsBadge;
