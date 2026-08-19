import { escHtml } from '../../../utils.js';
import { normalizePrometheusQuestionRecord } from './model.js';
import { encodeInlineJsString } from '../rendering/inline-escape.js';

/** Render a Prometheus Question Card without owning answer submission/session state. */
export function renderInlinePrometheusQuestion(item) {
  if (!item || !item.id) return '';
  const question = normalizePrometheusQuestionRecord(item);
  if (!question.id) return '';
  const pending = question.status === 'pending';
  const idAttr = escHtml(question.id);
  const idArg = encodeInlineJsString(question.id);
  const statusLabel = question.status === 'answered' ? 'answered' : question.status;
  const answerMap = new Map((question.answers || []).map((answer) => [String(answer?.id || ''), answer || {}]));
  const questionBlocks = question.questions.map((q, index) => {
    const answer = answerMap.get(q.id) || {};
    const qName = `${question.id}__${q.id}`;
    const qIdArg = encodeInlineJsString(q.id);
    const selected = Array.isArray(answer.selected) ? answer.selected : [];
    const other = String(answer.other || '').trim();
    const text = String(answer.text || '').trim();
    if (!pending) {
      const selectedText = selected.length ? selected.join(', ') : '';
      const answerText = [selectedText, text, other ? `Other: ${other}` : ''].filter(Boolean).join('\n') || 'No answer';
      return `<div class="chat-approval-scope"><span>${escHtml(q.label)}</span>${escHtml(answerText).replace(/\n/g, '<br>')}</div>`;
    }
    const options = (q.options || []).map((option, optIndex) => {
      const inputId = `${qName}__${optIndex}`;
      const type = q.mode === 'multi_select' ? 'checkbox' : 'radio';
      // For single_select radios, allow re-clicking a checked option to deselect it.
      const deselect = type === 'radio' ? ` onmousedown="toggleQuestionRadio(${encodeInlineJsString(inputId)})"` : '';
      return `<label for="${escHtml(inputId)}" class="pq-option">
        <input id="${escHtml(inputId)}" type="${type}" name="${escHtml(qName)}" value="${escHtml(option)}" data-question-id="${escHtml(q.id)}"${deselect} />
        <span>${escHtml(option)}</span>
      </label>`;
    }).join('');
    const otherInput = q.allowOther && q.mode !== 'text'
      ? `<div class="pq-other-row"><button type="button" class="pq-other-toggle" onclick="toggleQuestionOther(${idArg}, ${qIdArg})">Other</button></div>`
      : '';
    return `<div class="pq-block" data-question-compose-id="${escHtml(q.id)}" data-question-compose-mode="${escHtml(q.mode)}" data-question-compose-other="${q.allowOther ? 'true' : 'false'}" style="margin-top:${index ? 10 : 0}px">
      <div class="pq-q-label">${escHtml(q.label)}${q.required ? '' : ' <span class="pq-optional">(optional)</span>'}</div>
      ${q.helpText ? `<div class="chat-approval-subdetail">${escHtml(q.helpText)}</div>` : ''}
      ${options ? `<div class="pq-options">${options}</div>` : ''}
      ${otherInput}
    </div>`;
  }).join('');
  return `<div class="chat-approval-card chat-approval-card-low chat-question-card chat-question-card-${escHtml(statusLabel)}" data-question-id="${idAttr}">
    <div class="chat-approval-head">
      <div>
        <div class="chat-approval-kicker">${pending ? (question.questions.length > 1 ? 'Prometheus has a few questions' : 'Prometheus has a question') : 'Question result'}</div>
        <div class="chat-approval-title">${escHtml(question.title || 'Prometheus question')}</div>
      </div>
      <div class="chat-approval-badges">
        <span class="chat-approval-status chat-approval-status-${escHtml(statusLabel)}">${escHtml(statusLabel)}</span>
      </div>
    </div>
    ${question.prompt ? `<div class="chat-approval-detail">${escHtml(question.prompt)}</div>` : ''}
    ${question.context ? `<div class="chat-approval-subdetail">${escHtml(question.context)}</div>` : ''}
    ${questionBlocks}
    ${!pending && question.generalOther ? `<div class="chat-approval-scope"><span>Anything else</span>${escHtml(question.generalOther).replace(/\n/g, '<br>')}</div>` : ''}
    ${pending
      ? `<div class="chat-approval-actions">
          <button class="chat-approval-btn chat-approval-deny" type="button" onclick="cancelInlinePrometheusQuestion(${idArg})">Cancel</button>
        </div>`
      : `<div class="chat-approval-resolved">This question was ${escHtml(statusLabel)}.</div>`}
  </div>`;
}
