import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appendAuditEntry } from './audit-log';

export type PrometheusQuestionMode = 'single_select' | 'multi_select' | 'text';
export type PrometheusQuestionStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

export interface PrometheusQuestionItem {
  id: string;
  label: string;
  mode: PrometheusQuestionMode;
  options?: string[];
  allowOther?: boolean;
  required?: boolean;
  helpText?: string;
}

export interface PrometheusQuestionAnswer {
  id: string;
  label?: string;
  mode?: PrometheusQuestionMode;
  selected?: string[];
  text?: string;
  other?: string;
}

export interface PrometheusQuestionRecord {
  id: string;
  sessionId: string;
  taskId?: string;
  agentId?: string;
  originType?: 'main_chat' | 'subagent' | 'background_task' | 'scheduled_task' | 'unknown';
  originLabel?: string;
  title: string;
  prompt: string;
  context?: string;
  questions: PrometheusQuestionItem[];
  allowGeneralOther?: boolean;
  createdAt: string;
  status: PrometheusQuestionStatus;
  answers?: PrometheusQuestionAnswer[];
  generalOther?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  expiresAt?: number;
}

export interface SubmitPrometheusQuestionInput {
  questionId: string;
  answers?: PrometheusQuestionAnswer[];
  generalOther?: string;
  resolvedBy?: string;
}

export interface SubmitPrometheusQuestionResult {
  success: boolean;
  statusCode: number;
  error?: string;
  question?: PrometheusQuestionRecord;
  resumePrompt?: string;
  requiresChatResume?: boolean;
}

function truncateQuestionValue(value: any, max = 4000): any {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 60).map((item) => truncateQuestionValue(item, Math.floor(max / 2)));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = truncateQuestionValue(item, Math.floor(max / 2));
    }
    return out;
  }
  return String(value);
}

function normalizeQuestionMode(value: any): PrometheusQuestionMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'multi_select' || raw === 'multiple' || raw === 'multi') return 'multi_select';
  if (raw === 'text' || raw === 'free_text') return 'text';
  return 'single_select';
}

function normalizeOptions(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of value) {
    const option = String(item || '').trim().slice(0, 160);
    if (!option || seen.has(option.toLowerCase())) continue;
    seen.add(option.toLowerCase());
    options.push(option);
    if (options.length >= 8) break;
  }
  return options;
}

function normalizeQuestionItem(raw: any, index: number): PrometheusQuestionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label || raw.question || raw.prompt || '').trim().slice(0, 320);
  if (!label) return null;
  const mode = normalizeQuestionMode(raw.mode || raw.type || raw.selectionMode);
  const options = mode === 'text' ? [] : normalizeOptions(raw.options || raw.choices);
  return {
    id: String(raw.id || `q${index + 1}`).trim().replace(/[^\w.-]+/g, '_').slice(0, 80) || `q${index + 1}`,
    label,
    mode,
    options,
    allowOther: raw.allowOther !== false && raw.allow_other !== false,
    required: raw.required !== false,
    helpText: String(raw.helpText || raw.help_text || '').trim().slice(0, 280) || undefined,
  };
}

export function createPrometheusQuestionPayload(input: {
  sessionId: string;
  taskId?: string;
  agentId?: string;
  originType?: PrometheusQuestionRecord['originType'];
  originLabel?: string;
  title?: string;
  prompt?: string;
  context?: string;
  questions?: any[];
  allowGeneralOther?: boolean;
  ttlMs?: number;
}): Omit<PrometheusQuestionRecord, 'id' | 'createdAt' | 'status'> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId is required.');
  const questions = (Array.isArray(input.questions) ? input.questions : [])
    .slice(0, 5)
    .map(normalizeQuestionItem)
    .filter(Boolean) as PrometheusQuestionItem[];
  if (!questions.length) throw new Error('At least one question is required.');
  const ttlMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(input.ttlMs || 6 * 60 * 60 * 1000)));
  return {
    sessionId,
    taskId: String(input.taskId || '').trim() || undefined,
    agentId: String(input.agentId || '').trim() || undefined,
    originType: input.originType || 'main_chat',
    originLabel: String(input.originLabel || '').trim() || undefined,
    title: String(input.title || 'Prometheus question').trim().slice(0, 180) || 'Prometheus question',
    prompt: String(input.prompt || 'Prometheus needs a little more direction.').trim().slice(0, 1200) || 'Prometheus needs a little more direction.',
    context: String(input.context || '').trim().slice(0, 1200) || undefined,
    questions,
    allowGeneralOther: input.allowGeneralOther !== false,
    expiresAt: Date.now() + ttlMs,
  };
}

export function serializePrometheusQuestionForClient(record: PrometheusQuestionRecord): Record<string, any> {
  return truncateQuestionValue({
    id: record.id,
    sessionId: record.sessionId,
    sourceSessionId: record.sessionId,
    taskId: record.taskId,
    agentId: record.agentId,
    originType: record.originType,
    originLabel: record.originLabel,
    title: record.title,
    prompt: record.prompt,
    context: record.context,
    questions: record.questions,
    allowGeneralOther: record.allowGeneralOther,
    createdAt: record.createdAt,
    status: record.status,
    answers: record.answers,
    generalOther: record.generalOther,
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
    expiresAt: record.expiresAt,
  });
}

function normalizeAnswers(record: PrometheusQuestionRecord, answers: any): PrometheusQuestionAnswer[] {
  const rawAnswers = Array.isArray(answers) ? answers : [];
  const byId = new Map<string, any>();
  for (const item of rawAnswers) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (id) byId.set(id, item);
  }
  return record.questions.map((question) => {
    const raw = byId.get(question.id) || {};
    const selectedRaw = Array.isArray(raw.selected) ? raw.selected : [];
    const allowed = new Set((question.options || []).map((option) => option.toLowerCase()));
    let selected = selectedRaw
      .map((item: any) => String(item || '').trim())
      .filter((item: string) => item && (!allowed.size || allowed.has(item.toLowerCase())));
    if (question.mode === 'single_select') selected = selected.slice(0, 1);
    if (question.mode === 'text') selected = [];
    return {
      id: question.id,
      label: question.label,
      mode: question.mode,
      selected,
      text: String(raw.text || '').trim().slice(0, 2000) || undefined,
      other: question.allowOther ? String(raw.other || '').trim().slice(0, 2000) || undefined : undefined,
    };
  });
}

class PrometheusQuestionQueue {
  private records: Map<string, PrometheusQuestionRecord> = new Map();
  private callbacks: Map<string, (answers: { answers: PrometheusQuestionAnswer[]; generalOther?: string }) => void> = new Map();
  private steerCallbacks: Map<string, (steerMessage: string) => void> = new Map();

  constructor() {
    this.loadDurableRecords();
  }

  private storePath(): string {
    const root = process.env.PROMETHEUS_DATA_DIR
      || process.env.PROMETHEUS_APP_ROOT
      || path.resolve(__dirname, '..', '..');
    const dir = path.join(root, '.prometheus');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'questions.json');
  }

  private persistDurableRecords(): void {
    try {
      const records = [...this.records.values()]
        .filter((record) => record.status === 'pending' || Date.now() - new Date(record.resolvedAt || record.createdAt).getTime() < 24 * 60 * 60 * 1000);
      const p = this.storePath();
      const tmp = `${p}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify({ questions: records }, null, 2), 'utf-8');
      fs.renameSync(tmp, p);
    } catch (err: any) {
      console.warn('[PrometheusQuestions] Failed to persist questions:', err?.message || err);
    }
  }

  private loadDurableRecords(): void {
    try {
      const p = this.storePath();
      if (!fs.existsSync(p)) return;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const records = Array.isArray(parsed?.questions) ? parsed.questions : [];
      for (const raw of records) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim();
        const sessionId = String(raw.sessionId || '').trim();
        if (!id || !sessionId || !Array.isArray(raw.questions)) continue;
        const status = ['pending', 'answered', 'cancelled', 'expired'].includes(raw.status) ? raw.status : 'pending';
        this.records.set(id, {
          ...raw,
          id,
          sessionId,
          title: String(raw.title || 'Prometheus question'),
          prompt: String(raw.prompt || ''),
          questions: raw.questions.map(normalizeQuestionItem).filter(Boolean),
          createdAt: String(raw.createdAt || new Date().toISOString()),
          status,
        } as PrometheusQuestionRecord);
      }
      if (records.length) console.log(`[PrometheusQuestions] Restored ${this.records.size} durable question(s)`);
    } catch (err: any) {
      console.warn('[PrometheusQuestions] Failed to restore questions:', err?.message || err);
    }
  }

  create(partial: Omit<PrometheusQuestionRecord, 'id' | 'createdAt' | 'status'>): PrometheusQuestionRecord {
    const id = crypto.randomUUID();
    const record: PrometheusQuestionRecord = {
      ...partial,
      id,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.records.set(id, record);
    this.persistDurableRecords();
    console.log(`[PrometheusQuestions] Created question ${id} for session ${record.sessionId}`);
    return record;
  }

  get(id: string): PrometheusQuestionRecord | null {
    return this.records.get(id) || null;
  }

  listAll(): PrometheusQuestionRecord[] {
    return [...this.records.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  listPending(): PrometheusQuestionRecord[] {
    return this.listAll().filter((record) => record.status === 'pending');
  }

  hasResolveCallback(id: string): boolean {
    return this.callbacks.has(id);
  }

  onResolve(id: string, callback: (answers: { answers: PrometheusQuestionAnswer[]; generalOther?: string }) => void): void {
    const record = this.records.get(id);
    if (record && record.status === 'answered') {
      callback({ answers: record.answers || [], generalOther: record.generalOther });
      return;
    }
    this.callbacks.set(id, callback);
  }

  onSteer(id: string, callback: (steerMessage: string) => void): void {
    this.steerCallbacks.set(id, callback);
  }

  clearSteerCallback(id: string): void {
    this.steerCallbacks.delete(id);
  }

  notifySteer(id: string, steerMessage: string): boolean {
    const cb = this.steerCallbacks.get(id);
    if (!cb) return false;
    this.steerCallbacks.delete(id);
    cb(steerMessage);
    return true;
  }

  submit(id: string, answers: PrometheusQuestionAnswer[], generalOther = '', resolvedBy = 'user'): PrometheusQuestionRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return null;
    record.status = 'answered';
    record.answers = answers;
    record.generalOther = String(generalOther || '').trim().slice(0, 2000) || undefined;
    record.resolvedAt = new Date().toISOString();
    record.resolvedBy = resolvedBy;

    const cb = this.callbacks.get(id);
    if (cb) {
      cb({ answers: record.answers || [], generalOther: record.generalOther });
      this.callbacks.delete(id);
    }

    try {
      appendAuditEntry({
        sessionId: record.sessionId,
        agentId: record.agentId,
        actionType: 'tool_executed' as any,
        toolName: 'ask_prometheus_questions',
        toolArgs: { questionId: record.id, title: record.title, questions: record.questions },
        policyTier: 'propose',
        approvalStatus: 'auto_allowed' as any,
        resultSummary: `Prometheus question answered by ${resolvedBy}`,
      });
    } catch {}

    this.persistDurableRecords();
    return record;
  }

  cancel(id: string, resolvedBy = 'user'): PrometheusQuestionRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return null;
    record.status = 'cancelled';
    record.resolvedAt = new Date().toISOString();
    record.resolvedBy = resolvedBy;
    this.callbacks.delete(id);
    this.steerCallbacks.delete(id);
    this.persistDurableRecords();
    return record;
  }
}

let questionQueueInstance: PrometheusQuestionQueue | null = null;

export function getPrometheusQuestionQueue(): PrometheusQuestionQueue {
  if (!questionQueueInstance) questionQueueInstance = new PrometheusQuestionQueue();
  return questionQueueInstance;
}

export function submitPrometheusQuestionResponse(input: SubmitPrometheusQuestionInput): SubmitPrometheusQuestionResult {
  const questionId = String(input.questionId || '').trim();
  const resolvedBy = String(input.resolvedBy || 'user').trim() || 'user';
  if (!questionId) return { success: false, statusCode: 400, error: 'Question id is required' };
  const queue = getPrometheusQuestionQueue();
  const question = queue.get(questionId);
  if (!question) return { success: false, statusCode: 404, error: 'Question not found' };
  if (question.status !== 'pending') return { success: false, statusCode: 409, error: `Question already ${question.status}` };

  const hadLiveWaiter = queue.hasResolveCallback(questionId);
  const answers = normalizeAnswers(question, input.answers || []);
  const missingRequired = question.questions.filter((item) => {
    if (item.required === false) return false;
    const answer = answers.find((candidate) => candidate.id === item.id);
    return !answer
      || (!(answer.selected || []).length && !String(answer.text || '').trim() && !String(answer.other || '').trim());
  });
  if (missingRequired.length) {
    return {
      success: false,
      statusCode: 400,
      error: `Please answer: ${missingRequired.map((item) => item.label).join('; ')}`,
      question,
    };
  }
  const resolved = queue.submit(questionId, answers, input.generalOther, resolvedBy);
  if (!resolved) return { success: false, statusCode: 409, error: 'Question could not be answered' };

  let resumePrompt = '';
  if (!hadLiveWaiter) {
    resumePrompt = [
      `The pending Prometheus question "${resolved.id}" was answered after a gateway restart or while no live waiter was attached.`,
      `Original question prompt: ${resolved.prompt}`,
      `User answers:\n${JSON.stringify({ answers: resolved.answers || [], generalOther: resolved.generalOther || '' }, null, 2)}`,
      'Continue the interrupted work using these answers. Do not ask the same question again unless the answer is insufficient.',
    ].join('\n');
  }

  try {
    const { broadcastWS } = require('./comms/broadcaster');
    broadcastWS({
      type: 'question_answered',
      sessionId: resolved.sessionId,
      taskId: resolved.taskId,
      questionId: resolved.id,
      question: serializePrometheusQuestionForClient(resolved),
      resumePrompt: resumePrompt || undefined,
      requiresChatResume: !!resumePrompt,
    });
  } catch {}

  return {
    success: true,
    statusCode: 200,
    question: resolved,
    resumePrompt,
    requiresChatResume: !!resumePrompt,
  };
}
