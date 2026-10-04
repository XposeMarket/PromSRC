/**
 * Model-authored interactive cards, written by Prom as fenced blocks:
 *   ```quiz  ```flashcards  ```poll  ```writing  ```followups  ```reminder
 * Rendering is a pure function of (spec, state) so a chat re-render never
 * loses progress: state lives in the shared card-state store keyed by card id.
 */
import { esc, encodeCardData, parseCardBody, cardError, ICON } from './card-utils.js';

function shell(kind, id, spec, inner, extraClass = '') {
  return `<div class="pc-card pc-${kind} ${extraClass}" data-pc-kind="${kind}" data-pc-id="${esc(id)}" data-card-json="${encodeCardData(spec)}">${inner}</div>`;
}

function head(label, title) {
  return `<div class="pc-head"><span class="pc-kicker">${esc(label)}</span>${title ? `<span class="pc-title">${esc(title)}</span>` : ''}</div>`;
}

// ── normalizers (accept the shapes models actually emit) ──────────────────

export function normalizeQuiz(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.questions || raw?.items || []);
  const questions = list.map((q) => {
    const options = (q?.options || q?.choices || q?.answers || []).map((o) => (typeof o === 'string' ? o : String(o?.text ?? o?.label ?? '')));
    let answer = q?.answer ?? q?.correct ?? q?.correctIndex ?? q?.correct_answer;
    if (typeof answer === 'string' && !/^\d+$/.test(answer)) {
      const letter = /^[A-Za-z]$/.test(answer.trim()) ? answer.trim().toUpperCase().charCodeAt(0) - 65 : -1;
      answer = letter >= 0 && letter < options.length ? letter : options.findIndex((o) => o.trim().toLowerCase() === answer.trim().toLowerCase());
    }
    return { question: String(q?.question ?? q?.q ?? q?.prompt ?? ''), options, answer: Number(answer), hint: q?.hint ? String(q.hint) : '', explanation: String(q?.explanation ?? q?.why ?? '') };
  }).filter((q) => q.question && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
  return { title: String(raw?.title || ''), questions };
}

export function normalizeFlashcards(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.cards || raw?.items || []);
  const cards = list.map((c) => ({ front: String(c?.front ?? c?.term ?? c?.q ?? c?.question ?? ''), back: String(c?.back ?? c?.definition ?? c?.a ?? c?.answer ?? '') })).filter((c) => c.front && c.back);
  return { title: String(raw?.title || ''), cards };
}

function lines(body) {
  return String(body || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
}

// ── renderers ──────────────────────────────────────────────────────────────

function renderQuiz(id, spec, st) {
  const qs = spec.questions;
  if (!qs.length) return cardError('quiz', 'A quiz needs questions with options and an answer index.');
  const picks = st.picks || {}; const locked = st.locked || {}; const hints = st.hints || {};
  if (st.done) {
    const score = qs.filter((q, i) => picks[i] === q.answer).length;
    const rows = qs.map((q, i) => `<li class="${picks[i] === q.answer ? 'ok' : 'bad'}"><span>${picks[i] === q.answer ? '✓' : '✗'}</span>${esc(q.question)}</li>`).join('');
    return shell('quiz', id, spec, `${head('Quiz', spec.title)}<div class="pc-score"><strong>${score}/${qs.length}</strong><span>${score === qs.length ? 'Perfect score' : score >= qs.length / 2 ? 'Nice work' : 'Keep practicing'}</span></div><ol class="pc-review">${rows}</ol><div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="quiz-retry">Retry quiz</button></div>`);
  }
  const i = Math.min(st.i || 0, qs.length - 1); const q = qs[i]; const pick = picks[i]; const isLocked = !!locked[i];
  const opts = q.options.map((o, k) => {
    const cls = isLocked ? (k === q.answer ? 'correct' : (k === pick ? 'wrong' : 'dim')) : (k === pick ? 'picked' : '');
    return `<button type="button" class="pc-opt ${cls}" data-pc-act="quiz-pick" data-k="${k}" ${isLocked ? 'disabled' : ''}><span class="pc-opt-key">${String.fromCharCode(65 + k)}</span><span>${esc(o)}</span></button>`;
  }).join('');
  const feedback = isLocked ? `<div class="pc-feedback ${pick === q.answer ? 'ok' : 'bad'}"><strong>${pick === q.answer ? 'Correct!' : `Not quite. The answer is ${String.fromCharCode(65 + q.answer)}.`}</strong>${q.explanation ? `<span>${esc(q.explanation)}</span>` : ''}</div>` : '';
  const hint = hints[i] && q.hint ? `<div class="pc-hint">💡 ${esc(q.hint)}</div>` : '';
  const last = i === qs.length - 1;
  const actions = isLocked
    ? `<button type="button" class="pc-btn primary" data-pc-act="${last ? 'quiz-finish' : 'quiz-next'}">${last ? 'See results' : 'Next question'}</button>`
    : `${q.hint && !hints[i] ? '<button type="button" class="pc-btn" data-pc-act="quiz-hint">Hint</button>' : ''}<button type="button" class="pc-btn primary" data-pc-act="quiz-lock" ${pick == null ? 'disabled' : ''}>Lock in</button>`;
  const dots = qs.map((_, k) => `<span class="${k === i ? 'on' : (locked[k] ? (picks[k] === qs[k].answer ? 'ok' : 'bad') : '')}"></span>`).join('');
  return shell('quiz', id, spec, `${head('Quiz', spec.title)}<div class="pc-progress-row"><span>Question ${i + 1} of ${qs.length}</span><span class="pc-dots">${dots}</span></div><div class="pc-question">${esc(q.question)}</div><div class="pc-opts">${opts}</div>${hint}${feedback}<div class="pc-actions">${actions}</div>`);
}

function renderFlashcards(id, spec, st) {
  const all = spec.cards;
  if (!all.length) return cardError('flashcards', 'Flashcards need cards with a front and a back.');
  const order = Array.isArray(st.order) && st.order.length ? st.order : all.map((_, k) => k);
  const known = st.known || []; const missed = st.missed || [];
  const pos = st.pos || 0;
  if (pos >= order.length) {
    return shell('flashcards', id, spec, `${head('Flashcards', spec.title)}<div class="pc-score"><strong>${known.length}/${order.length}</strong><span>known this round</span></div><div class="pc-actions">${missed.length ? `<button type="button" class="pc-btn primary" data-pc-act="fc-missed">Review ${missed.length} missed</button>` : ''}<button type="button" class="pc-btn" data-pc-act="fc-restart">Start over</button></div>`);
  }
  const card = all[order[pos]];
  const pct = Math.round((pos / order.length) * 100);
  return shell('flashcards', id, spec, `${head('Flashcards', spec.title)}<div class="pc-bar"><span style="width:${pct}%"></span></div><button type="button" class="pc-flip ${st.flipped ? 'flipped' : ''}" data-pc-act="fc-flip" aria-label="Flip card"><span class="pc-flip-side">${st.flipped ? 'Answer' : 'Term'}</span><span class="pc-flip-text">${esc(st.flipped ? card.back : card.front)}</span><span class="pc-muted">${st.flipped ? '' : 'Tap to flip'}</span></button><div class="pc-progress-row"><span>${pos + 1} / ${order.length}</span><span>✓ ${known.length} · ✗ ${missed.length}</span></div><div class="pc-actions split"><button type="button" class="pc-btn bad" data-pc-act="fc-miss">Still learning</button><button type="button" class="pc-btn good" data-pc-act="fc-know">Got it</button></div>`);
}

function renderPoll(id, spec, st) {
  const question = String(spec?.question || spec?.title || '');
  const options = (spec?.options || []).map(String).filter(Boolean);
  if (!question || options.length < 2) return cardError('poll', 'A poll needs a question and at least two options.');
  const picks = st.picks || [];
  const multiple = !!spec.multiple;
  if (st.sent) {
    const rows = options.map((o, k) => `<div class="pc-poll-row ${picks.includes(k) ? 'mine' : ''}"><span>${esc(o)}</span><span>${picks.includes(k) ? 'Your answer' : ''}</span></div>`).join('');
    return shell('poll', id, spec, `${head('Poll', '')}<div class="pc-question">${esc(question)}</div>${rows}<div class="pc-muted">Sent to Prom.</div>`);
  }
  const opts = options.map((o, k) => `<button type="button" class="pc-opt ${picks.includes(k) ? 'picked' : ''}" data-pc-act="poll-pick" data-k="${k}"><span class="pc-check">${picks.includes(k) ? '●' : '○'}</span><span>${esc(o)}</span></button>`).join('');
  return shell('poll', id, spec, `${head('Poll', multiple ? 'Pick any' : '')}<div class="pc-question">${esc(question)}</div><div class="pc-opts">${opts}</div><div class="pc-actions"><button type="button" class="pc-btn primary" data-pc-act="poll-send" ${picks.length ? '' : 'disabled'}>Send answer</button></div>`);
}

function renderWriting(id, spec, st) {
  const text = String(spec?.text ?? spec?.body ?? spec?.content ?? '');
  if (!text.trim()) return cardError('writing', 'Nothing to show.');
  const words = text.trim().split(/\s+/).length;
  const label = String(spec?.kind || 'Draft');
  const subject = spec?.subject ? `<div class="pc-writing-subject"><span>Subject</span>${esc(spec.subject)}</div>` : '';
  return shell('writing', id, spec, `<div class="pc-head"><span class="pc-kicker">${esc(label)}</span>${spec?.title ? `<span class="pc-title">${esc(spec.title)}</span>` : ''}<button type="button" class="pc-icon-btn" data-pc-act="copy" title="Copy">${ICON.copy}<span>${st.copied ? 'Copied' : 'Copy'}</span></button></div>${subject}<div class="pc-writing-body">${esc(text)}</div><div class="pc-writing-foot"><span class="pc-muted">${words} words · ${text.length} characters</span><span class="pc-chips"><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${esc(label.toLowerCase())} shorter.">Shorter</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${esc(label.toLowerCase())} more casual.">More casual</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${esc(label.toLowerCase())} more formal.">More formal</button></span></div>`);
}

function renderFollowups(id, spec) {
  const items = (Array.isArray(spec) ? spec : spec?.items || []).map((x) => String(typeof x === 'string' ? x : x?.prompt || x?.label || '')).filter(Boolean).slice(0, 6);
  if (!items.length) return '';
  return `<div class="pc-followups" data-pc-id="${esc(id)}">${items.map((p) => `<button type="button" class="pc-followup" data-pc-act="send" data-prompt="${esc(p)}"><span>${esc(p)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div>`;
}

function renderReminder(id, spec, st) {
  const title = String(spec?.title || spec?.text || '');
  const when = String(spec?.when || spec?.time || spec?.at || '');
  if (!title) return cardError('reminder', 'A reminder needs a title.');
  const status = st.status === 'set' ? '<div class="pc-feedback ok"><strong>Asked Prom to set it.</strong></div>' : st.status === 'dismissed' ? '<div class="pc-muted">Dismissed.</div>' : '';
  const actions = st.status ? '' : '<div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="rem-dismiss">Not now</button><button type="button" class="pc-btn primary" data-pc-act="rem-set">Set reminder</button></div>';
  return shell('reminder', id, spec, `<div class="pc-rem"><span class="pc-rem-icon">${ICON.bell}</span><div><div class="pc-title">${esc(title)}</div>${when ? `<div class="pc-muted">${esc(when)}</div>` : ''}${spec?.details ? `<div class="pc-muted">${esc(spec.details)}</div>` : ''}</div></div>${status}${actions}`);
}

export const INTERACTIVE_FENCES = ['quiz', 'flashcards', 'poll', 'writing', 'followups', 'reminder'];

/** Render one fenced card. `state` is the persisted per-card state object. */
export function renderInteractiveCard(kind, id, body, state = {}) {
  let raw = parseCardBody(body);
  if (kind === 'followups' && !raw) raw = { items: lines(body) };
  if (kind === 'writing' && !raw) raw = { text: String(body || '').trim() };
  if (!raw) return cardError(kind, 'The card body is not valid JSON.');
  switch (kind) {
    case 'quiz': return renderQuiz(id, normalizeQuiz(raw), state);
    case 'flashcards': return renderFlashcards(id, normalizeFlashcards(raw), state);
    case 'poll': return renderPoll(id, raw, state);
    case 'writing': return renderWriting(id, raw, state);
    case 'followups': return renderFollowups(id, raw);
    case 'reminder': return renderReminder(id, raw, state);
    default: return '';
  }
}

/** Pure reducer: returns the next state for an action on a card. */
export function reduceInteractiveCard(kind, spec, state, act, data = {}) {
  const st = { ...(state || {}) };
  const k = Number(data.k);
  if (kind === 'quiz') {
    const qs = normalizeQuiz(spec).questions; const i = st.i || 0;
    if (act === 'quiz-pick') st.picks = { ...(st.picks || {}), [i]: k };
    if (act === 'quiz-hint') st.hints = { ...(st.hints || {}), [i]: true };
    if (act === 'quiz-lock' && st.picks?.[i] != null) st.locked = { ...(st.locked || {}), [i]: true };
    if (act === 'quiz-next') st.i = Math.min(qs.length - 1, i + 1);
    if (act === 'quiz-finish') st.done = true;
    if (act === 'quiz-retry') return {};
  } else if (kind === 'flashcards') {
    const n = normalizeFlashcards(spec).cards.length;
    const order = Array.isArray(st.order) && st.order.length ? st.order : Array.from({ length: n }, (_, x) => x);
    const cur = order[st.pos || 0];
    if (act === 'fc-flip') st.flipped = !st.flipped;
    if (act === 'fc-know' || act === 'fc-miss') {
      const key = act === 'fc-know' ? 'known' : 'missed';
      st[key] = [...(st[key] || []), cur]; st.pos = (st.pos || 0) + 1; st.flipped = false; st.order = order;
    }
    if (act === 'fc-missed') return { order: [...(st.missed || [])] };
    if (act === 'fc-restart') return {};
  } else if (kind === 'poll') {
    if (act === 'poll-pick') {
      const picks = new Set(st.picks || []);
      if (spec?.multiple) { picks.has(k) ? picks.delete(k) : picks.add(k); st.picks = [...picks]; } else st.picks = [k];
    }
    if (act === 'poll-send') st.sent = true;
  } else if (kind === 'writing') {
    if (act === 'copy') st.copied = true;
  } else if (kind === 'reminder') {
    if (act === 'rem-set') st.status = 'set';
    if (act === 'rem-dismiss') st.status = 'dismissed';
  }
  return st;
}
