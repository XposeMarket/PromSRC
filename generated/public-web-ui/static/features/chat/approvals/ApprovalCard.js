import { escHtml } from '../../../utils.js';
import { getApprovalRiskLevel, normalizeChatApprovalRecord } from './model.js';
import { encodeInlineJsString } from '../rendering/inline-escape.js';

/** Render a normalized approval request without owning transport/session state. */
export function renderInlineApprovalRequest(item) {
  if (!item || !item.id) return '';
  const approval = normalizeChatApprovalRecord(item);
  const risk = getApprovalRiskLevel(approval.riskScore || 0);
  const systems = Array.isArray(approval.affectedSystems) ? approval.affectedSystems.filter(Boolean) : [];
  const pending = approval.status === 'pending';
  const statusLabel = approval.status === 'approved' ? 'approved' : approval.status === 'rejected' ? 'denied' : approval.status;
  const idArg = encodeInlineJsString(approval.id);
  const approveEndpoint = encodeInlineJsString(`/api/approvals/${approval.id}/approve`);
  const denyEndpoint = encodeInlineJsString(`/api/approvals/${approval.id}/deny`);
  const technicalText = approval.command || approval.scopedAction || approval.action;
  const isDevSource = approval.approvalKind === 'dev_source_edit' || approval.toolName === 'request_dev_source_edit';
  const isFinalAction = approval.approvalKind === 'final_action' || approval.toolName === 'request_final_action_approval';
  const isOneShot = approval.oneShot === true || approval.approvalKind === 'elevated_command' || isDevSource || isFinalAction;
  const isCommandApproval = approval.toolName === 'run_command' && approval.approvalKind !== 'elevated_command';
  const sourceFiles = Array.isArray(approval.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
  const sourceDirs = Array.isArray(approval.devSourceEdit?.allowedDirs) ? approval.devSourceEdit.allowedDirs : [];
  const verificationCommand = approval.devSourceEdit?.verificationCommand || '';
  const commandBoundary = approval.commandBoundary || null;
  const boundaryScope = String(commandBoundary?.scope || '').trim();
  const boundaryPaths = Array.isArray(commandBoundary?.externalPaths) ? commandBoundary.externalPaths.filter(Boolean) : [];
  const pathAccessPaths = Array.from(new Set([
    approval.pathAccess?.requestedPath,
    ...(Array.isArray(approval.pathAccess?.requestedPaths) ? approval.pathAccess.requestedPaths : []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const boundaryEnv = Array.isArray(commandBoundary?.environmentChanges) ? commandBoundary.environmentChanges.filter(Boolean) : [];
  const devPlan = approval.devSourceEdit?.plan || null;
  const devEvidence = Array.isArray(devPlan?.evidence) ? devPlan.evidence : [];
  const devSteps = Array.isArray(devPlan?.steps) ? devPlan.steps : [];
  const devExpectedWorkflow = Array.isArray(devPlan?.expectedWorkflow)
    ? devPlan.expectedWorkflow
    : (Array.isArray(devPlan?.expected_workflow) ? devPlan.expected_workflow : []);
  const showTechnicalDetails = Boolean(technicalText || approval.reason || systems.length || approval.scopedTarget);
  return `<div class="chat-approval-card chat-approval-card-${risk} chat-approval-card-${escHtml(statusLabel)} ${pending ? 'chat-approval-card-pending' : 'chat-approval-card-resolved'}" data-approval-id="${escHtml(approval.id)}">
    <div class="chat-approval-head">
      <div>
        <div class="chat-approval-kicker">${pending ? 'Approval needed' : 'Approval result'}</div>
        <div class="chat-approval-title">${escHtml(approval.title || 'Approval required')}</div>
      </div>
      <div class="chat-approval-badges">
        <span class="chat-approval-status chat-approval-status-${escHtml(statusLabel)}">${escHtml(statusLabel)}</span>
        ${pending ? `<span class="chat-approval-risk">risk ${escHtml(String(approval.riskScore ?? 0))}</span>` : ''}
      </div>
    </div>
    ${approval.summary ? `<div class="chat-approval-detail">${escHtml(approval.summary)}</div>` : ''}
    ${approval.humanDetail ? `<div class="chat-approval-subdetail">${escHtml(approval.humanDetail)}</div>` : ''}
    ${pending && devPlan?.reasoning ? `<div class="chat-approval-scope"><span>Reasoning</span>${escHtml(String(devPlan.reasoning))}</div>` : ''}
    ${pending && (devPlan?.currentState || devPlan?.fix) ? `<div class="chat-approval-scope"><span>Fix</span>${[
      devPlan.currentState ? `Current: ${String(devPlan.currentState)}` : '',
      devPlan.fix ? `Fix: ${String(devPlan.fix)}` : '',
    ].filter(Boolean).map(escHtml).join('<br>')}</div>` : ''}
    ${pending && devEvidence.length ? `<details class="chat-approval-technical" open>
      <summary>Evidence</summary>
      ${devEvidence.slice(0, 5).map((item) => `<div class="chat-approval-reason"><span>${escHtml(String(item.file || 'file'))}${item.lines ? `:${escHtml(String(item.lines))}` : ''}</span>${escHtml(String(item.finding || ''))}</div>`).join('')}
    </details>` : ''}
    ${pending && devSteps.length ? `<details class="chat-approval-technical">
      <summary>Plan</summary>
      <ol class="chat-approval-plan">${devSteps.slice(0, 8).map((step) => `<li>${escHtml(String(step))}</li>`).join('')}</ol>
    </details>` : ''}
    ${pending && devExpectedWorkflow.length ? `<details class="chat-approval-technical" open>
      <summary>Expected workflow after edits</summary>
      <ol class="chat-approval-plan">${devExpectedWorkflow.slice(0, 8).map((step) => `<li>${escHtml(String(step))}</li>`).join('')}</ol>
    </details>` : ''}
    ${pending && boundaryScope && boundaryScope !== 'workspace' ? `<div class="chat-approval-scope"><span>Boundary</span>${escHtml(boundaryScope.replace(/_/g, ' '))}${commandBoundary?.reason ? `<br>${escHtml(String(commandBoundary.reason))}` : ''}</div>` : ''}
    ${pending && pathAccessPaths.length ? `<div class="chat-approval-scope"><span>Path access requested</span>${pathAccessPaths.slice(0, 8).map((item) => escHtml(String(item))).join('<br>')}</div>` : ''}
    ${pending && boundaryPaths.length ? `<div class="chat-approval-scope"><span>External paths</span>${boundaryPaths.slice(0, 8).map((item) => escHtml(String(item))).join('<br>')}</div>` : ''}
    ${pending && boundaryEnv.length ? `<div class="chat-approval-scope"><span>Environment</span>${boundaryEnv.slice(0, 8).map((item) => escHtml(String(item))).join('<br>')}</div>` : ''}
    ${pending && sourceFiles.length ? `<div class="chat-approval-scope"><span>Files</span>${sourceFiles.map((file) => escHtml(String(file))).join('<br>')}</div>` : ''}
    ${pending && sourceDirs.length ? `<div class="chat-approval-scope"><span>Workspace docs</span>${sourceDirs.map((dir) => escHtml(String(dir))).join('<br>')}</div>` : ''}
    ${pending && verificationCommand ? `<div class="chat-approval-scope"><span>Verify</span>${escHtml(verificationCommand)}</div>` : ''}
    ${pending && showTechnicalDetails ? `<details class="chat-approval-technical">
      <summary>Technical details</summary>
      ${approval.reason ? `<div class="chat-approval-reason"><span>Reason</span>${escHtml(approval.reason)}</div>` : ''}
      ${technicalText ? `<pre class="chat-approval-command">${escHtml(technicalText)}</pre>` : ''}
      ${approval.scopedTarget ? `<div class="chat-approval-scope"><span>Scope</span>${escHtml(approval.scopedTarget)}</div>` : ''}
      ${systems.length ? `<div class="chat-approval-systems">${systems.map((system) => `<span>${escHtml(String(system))}</span>`).join('')}</div>` : ''}
    </details>` : ''}
    ${pending && isCommandApproval ? `<div class="chat-approval-process" data-approval-process="${escHtml(approval.id)}">
      <button class="chat-approval-process-toggle" type="button" onclick="loadApprovalProcessRun(${idArg})">Open terminal</button>
      <div class="chat-approval-process-body" id="approval-process-${escHtml(approval.id)}"></div>
    </div>` : ''}
    ${pending
      ? `<div class="chat-approval-actions">
          <button class="chat-approval-btn chat-approval-approve" type="button" onclick="resolveInlineApproval(${idArg}, 'approve', ${approveEndpoint})">Approve</button>
          <button class="chat-approval-btn chat-approval-deny" type="button" onclick="resolveInlineApproval(${idArg}, 'deny', ${denyEndpoint})">Reject</button>
          ${isOneShot ? '' : `<button class="chat-approval-link" type="button" onclick="resolveInlineApproval(${idArg}, 'approve_session', ${approveEndpoint}, 'session')">Trust this session</button>
          <button class="chat-approval-link" type="button" onclick="resolveInlineApproval(${idArg}, 'approve_always', ${approveEndpoint}, 'always')">Always allow</button>`}
        </div>`
      : `<div class="chat-approval-resolved">This request was ${escHtml(statusLabel)}.</div>`}
  </div>`;
}
