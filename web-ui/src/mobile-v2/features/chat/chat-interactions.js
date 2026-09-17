import {
  buildQuestionAnswerPayload,
  getMissingQuestionAnswers,
  normalizeQuestionRecord,
} from '../../../features/chat/questions/question-model.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function interactionId(record, kind) {
  if (!record || typeof record !== 'object') return '';
  return String(kind === 'approval'
    ? (record.id || record.approvalId || record.approval_id || '')
    : (record.id || record.questionId || record.question_id || ''));
}

function approvalTerminal(status) {
  return ['approved', 'rejected', 'denied', 'cancelled', 'expired', 'executed', 'failed'].includes(String(status || '').toLowerCase());
}

function questionTerminal(status) {
  return ['answered', 'resolved', 'cancelled', 'expired'].includes(String(status || '').toLowerCase());
}

function approvalMarkup(approval) {
  const id = interactionId(approval, 'approval');
  if (!id) return '';
  const status = String(approval.status || 'pending').toLowerCase();
  const terminal = approvalTerminal(status);
  const title = String(approval.title || approval.toolName || approval.tool || 'Action requires approval');
  const detail = String(
    approval.summary
    || approval.reason
    || approval.command
    || approval.scopedAction
    || approval.action
    || '',
  );
  const risk = Number(approval.riskScore);
  const riskLabel = Number.isFinite(risk) ? `Risk ${Math.round(risk * (risk <= 1 ? 100 : 1))}%` : '';
  const statusLabel = status === 'rejected' ? 'denied' : status;
  return `<section class="pm-v2-interaction-card pm-v2-approval-card" data-v2-approval-id="${escapeHtml(id)}">
    <div class="pm-v2-interaction-kicker">Approval${riskLabel ? ` · ${escapeHtml(riskLabel)}` : ''}</div>
    <strong class="pm-v2-interaction-title">${escapeHtml(title)}</strong>
    ${detail ? `<div class="pm-v2-interaction-detail">${escapeHtml(detail)}</div>` : ''}
    ${terminal
      ? `<div class="pm-v2-interaction-status ${status === 'approved' ? 'is-success' : 'is-muted'}">${escapeHtml(statusLabel)}</div>`
      : `<div class="pm-v2-interaction-actions"><button type="button" data-v2-approval-action="deny">Deny</button><button type="button" class="primary" data-v2-approval-action="approve">Approve</button></div>`}
  </section>`;
}

function answerFor(question, itemId) {
  return (Array.isArray(question.answers) ? question.answers : []).find((answer) => String(answer?.id || '') === String(itemId || '')) || {};
}

function questionItemMarkup(question, item, cardDisabled) {
  const answer = answerFor(question, item.id);
  const selected = new Set(Array.isArray(answer.selected) ? answer.selected.map(String) : []);
  const base = `${question.id}:${item.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const disabled = cardDisabled ? ' disabled' : '';
  let control = '';
  if (item.mode === 'text') {
    control = `<textarea rows="2" data-v2-question-text placeholder="Type your answer…"${disabled}>${escapeHtml(answer.text || '')}</textarea>`;
  } else {
    const type = item.mode === 'multi_select' ? 'checkbox' : 'radio';
    control = `<div class="pm-v2-question-options">${item.options.map((option, index) => `<label><input type="${type}" name="${escapeHtml(base)}" value="${escapeHtml(option)}" data-v2-question-choice${selected.has(String(option)) ? ' checked' : ''}${disabled}><span>${escapeHtml(option)}</span></label>`).join('')}</div>`;
  }
  const other = item.allowOther && item.mode !== 'text'
    ? `<input class="pm-v2-question-other" type="text" data-v2-question-other placeholder="Other…" value="${escapeHtml(answer.other || '')}"${disabled}>`
    : '';
  return `<fieldset class="pm-v2-question-item" data-v2-question-item-id="${escapeHtml(item.id)}" data-v2-question-mode="${escapeHtml(item.mode)}"${item.required === false ? '' : ' data-v2-question-required="1"'}${cardDisabled ? ' disabled' : ''}>
    <legend>${escapeHtml(item.label)}${item.required === false ? ' <span>Optional</span>' : ''}</legend>
    ${item.helpText ? `<div class="pm-v2-question-help">${escapeHtml(item.helpText)}</div>` : ''}
    ${control}${other}
  </fieldset>`;
}

function questionMarkup(input) {
  const question = normalizeQuestionRecord(input || {});
  if (!question.id) return '';
  const terminal = questionTerminal(question.status);
  return `<section class="pm-v2-interaction-card pm-v2-question-card" data-v2-question-id="${escapeHtml(question.id)}">
    <div class="pm-v2-interaction-kicker">Question</div>
    <strong class="pm-v2-interaction-title">${escapeHtml(question.title || 'Prometheus question')}</strong>
    ${question.prompt ? `<div class="pm-v2-interaction-detail">${escapeHtml(question.prompt)}</div>` : ''}
    ${question.context ? `<div class="pm-v2-question-context">${escapeHtml(question.context)}</div>` : ''}
    <div class="pm-v2-question-items">${question.questions.map((item) => questionItemMarkup(question, item, terminal)).join('')}</div>
    ${question.allowGeneralOther && !terminal ? '<textarea rows="2" class="pm-v2-question-general" data-v2-question-general placeholder="Anything else? (optional)"></textarea>' : ''}
    ${terminal
      ? `<div class="pm-v2-interaction-status is-muted">${escapeHtml(question.status)}</div>`
      : `<div class="pm-v2-interaction-actions"><button type="button" data-v2-question-action="cancel">Cancel</button><button type="button" class="primary" data-v2-question-action="submit">Submit</button></div>`}
  </section>`;
}

export function renderChatInteractions(message) {
  if (!message || message.role === 'user') return '';
  const approvals = (Array.isArray(message.approvals) ? message.approvals : []).map(approvalMarkup).join('');
  const questions = (Array.isArray(message.questions) ? message.questions : []).map(questionMarkup).join('');
  if (!approvals && !questions) return '';
  return `<div class="pm-v2-chat-interactions">${approvals}${questions}</div>`;
}

export function ensureChatInteractionStyles() {
  const id = 'pm-mobile-v2-chat-interactions-css';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = new URL('../../mobile-v2-chat-interactions.css', import.meta.url).href;
  document.head.appendChild(link);
}

function findInteraction(chatStore, gatewayId, sessionId, kind, id) {
  const key = kind === 'approval' ? 'approvals' : 'questions';
  const messages = chatStore.get(gatewayId, sessionId).messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const record = (messages[index][key] || []).find((item) => interactionId(item, kind) === id);
    if (record) return record;
  }
  return null;
}

function setCardBusy(card, busy) {
  card?.classList.toggle('is-busy', !!busy);
  card?.querySelectorAll('button,input,textarea').forEach((control) => { control.disabled = !!busy; });
}

function collectQuestionPayload(card, rawQuestion) {
  const question = normalizeQuestionRecord(rawQuestion || {});
  const answers = question.questions.map((item) => {
    const field = [...card.querySelectorAll('[data-v2-question-item-id]')]
      .find((node) => node.dataset.v2QuestionItemId === item.id);
    const selected = field
      ? [...field.querySelectorAll('[data-v2-question-choice]:checked')].map((input) => String(input.value || '').trim()).filter(Boolean)
      : [];
    return {
      id: item.id,
      selected,
      text: String(field?.querySelector('[data-v2-question-text]')?.value || '').trim(),
      other: String(field?.querySelector('[data-v2-question-other]')?.value || '').trim(),
    };
  });
  return buildQuestionAnswerPayload(question, {
    answers,
    generalOther: String(card.querySelector('[data-v2-question-general]')?.value || '').trim(),
  });
}

export function attachChatInteractionHandlers({
  thread,
  gateway,
  chatStore,
  gatewayId,
  sessionId,
  showNotice,
  onResumePrompt,
}) {
  if (!thread) return () => {};
  let disposed = false;

  async function handleApproval(button) {
    const card = button.closest('[data-v2-approval-id]');
    const id = String(card?.dataset.v2ApprovalId || '');
    const action = button.dataset.v2ApprovalAction === 'approve' ? 'approve' : 'deny';
    if (!id || !card) return;
    setCardBusy(card, true);
    try {
      const result = await gateway.request(`/api/approvals/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
      const fallbackStatus = action === 'approve' ? 'approved' : 'rejected';
      chatStore.updateInteraction(gatewayId, sessionId, 'approval', id, {
        ...(result?.approval || {}),
        status: result?.approval?.status || fallbackStatus,
      });
      showNotice?.(action === 'approve' ? 'Approved.' : 'Denied.');
      if (result?.resumePrompt) await onResumePrompt?.(String(result.resumePrompt));
    } catch (error) {
      setCardBusy(card, false);
      showNotice?.(error?.message || 'Could not resolve approval.');
    }
  }

  async function resolveQuestion(button) {
    const card = button.closest('[data-v2-question-id]');
    const id = String(card?.dataset.v2QuestionId || '');
    const action = button.dataset.v2QuestionAction;
    if (!id || !card || !action) return;
    const raw = findInteraction(chatStore, gatewayId, sessionId, 'question', id);
    if (!raw) return;
    setCardBusy(card, true);
    try {
      if (action === 'cancel') {
        const result = await gateway.request(`/api/questions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
        chatStore.updateInteraction(gatewayId, sessionId, 'question', id, {
          ...(result?.question || {}),
          status: result?.question?.status || 'cancelled',
        });
        showNotice?.('Question cancelled.');
        return;
      }

      const question = normalizeQuestionRecord(raw);
      const payload = collectQuestionPayload(card, question);
      const missing = getMissingQuestionAnswers(question, payload);
      if (missing.length) {
        setCardBusy(card, false);
        showNotice?.(`Please answer: ${missing.map((item) => item.label).join('; ')}`);
        return;
      }
      const result = await gateway.request(`/api/questions/${encodeURIComponent(id)}/submit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      chatStore.updateInteraction(gatewayId, sessionId, 'question', id, {
        ...(result?.question || {}),
        answers: payload.answers,
        generalOther: payload.generalOther,
        status: result?.question?.status || 'answered',
      });
      showNotice?.('Answer submitted.');
      if (result?.resumePrompt) await onResumePrompt?.(String(result.resumePrompt));
    } catch (error) {
      setCardBusy(card, false);
      showNotice?.(error?.message || 'Could not answer question.');
    }
  }

  const onClick = (event) => {
    if (disposed) return;
    const approvalButton = event.target.closest('[data-v2-approval-action]');
    if (approvalButton) {
      event.preventDefault();
      handleApproval(approvalButton);
      return;
    }
    const questionButton = event.target.closest('[data-v2-question-action]');
    if (questionButton) {
      event.preventDefault();
      resolveQuestion(questionButton);
    }
  };

  thread.addEventListener('click', onClick);
  return () => {
    disposed = true;
    thread.removeEventListener('click', onClick);
  };
}
