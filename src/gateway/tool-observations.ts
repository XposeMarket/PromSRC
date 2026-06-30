import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../config/config';
import { estimateTextTokensForModel } from './context/model-context';

export type ToolObservationStatus = 'ok' | 'error';

export interface ToolObservation {
  id: string;
  sessionId: string;
  turnId: string;
  stepNum: number;
  toolName: string;
  category: string;
  status: ToolObservationStatus;
  argsPreview: string;
  resultPreview: string;
  resultRawRef?: string;
  artifacts?: any[];
  pathsTouched?: string[];
  exitCode?: number;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
  tokenEstimate?: {
    argsTokens: number;
    resultTokens: number;
    totalTokens: number;
    argsChars: number;
    resultChars: number;
    resultBytes: number;
    contextCostMicros?: number;
    directCostMicros?: number;
    totalCostMicros?: number;
    pricingSource?: string;
    pricingVersion?: string;
  };
  createdAt: number;
}

export interface ObservationContextOptions {
  lookbackTurns?: number;
  maxChars?: number;
  maxObservations?: number;
  includeHeader?: boolean;
  includeTelemetry?: boolean;
}

const SECRET_KEY_RE = /(password|token|secret|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)/i;

function safeSessionFileName(sessionId: string): string {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function observationRoot(): string {
  return path.join(getConfig().getConfigDir(), 'tool-observations');
}

function observationJsonlPath(sessionId: string): string {
  return path.join(observationRoot(), `${safeSessionFileName(sessionId)}.jsonl`);
}

function rawRoot(sessionId: string): string {
  return path.join(observationRoot(), 'raw', safeSessionFileName(sessionId));
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? '***' : scrubValue(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 3000) return `${value.slice(0, 3000)}\n[...truncated]`;
  return value;
}

function stringifyPreview(value: unknown, maxChars: number): string {
  let text = '';
  try {
    text = typeof value === 'string' ? value : JSON.stringify(scrubValue(value), null, 2);
  } catch {
    text = String(value || '');
  }
  text = text.replace(/\r\n/g, '\n').trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[...truncated]`;
}

function inferToolCategory(toolName: string): string {
  const name = String(toolName || '').trim();
  if (!name) return 'other';
  if (/^(terminal|shell|run_command|run_command_supervised|start_process|process_)/.test(name)) return 'shell_process';
  if (/^(read|write|edit|list|delete|rename|copy|mkdir|stat|append|apply_patch|grep_|search_files|file_|source_|webui_source_)/.test(name)) return 'file';
  if (/^(shopping_search_products|web_search|web_fetch|download_)/.test(name)) return 'web';
  if (/^browser_/.test(name)) return 'browser';
  if (/^desktop_/.test(name)) return 'desktop';
  if (/^(memory_|persona_|write_note|schedule_memory)/.test(name)) return 'memory';
  if (/^skill_/.test(name)) return 'skill';
  if (/^(generate_image|generate_video|analyze_image|analyze_video|upload_image|fetch_image)/.test(name)) return 'media';
  if (/^(agent_|subagent_|bg_|start_task|task_control|complete_plan_step|step_complete)/.test(name)) return 'agent_task';
  if (/^(request_|approval_|propose_|grant_)/.test(name)) return 'approval';
  if (/^connector_/.test(name)) return 'connector';
  if (/^(creative_|canvas_|hyperframes_|vercel_)/.test(name)) return 'creative';
  return 'other';
}

function extractPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (node: unknown, depth = 0) => {
    if (depth > 4 || node == null) return;
    if (typeof node === 'string') {
      if (/[\\/]/.test(node) || /\.[a-z0-9]{1,8}$/i.test(node)) paths.add(node.slice(0, 500));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, inner] of Object.entries(node as Record<string, unknown>)) {
        if (/^(path|file|filename|target|cwd|output|dest|destination|source|url)$/i.test(key) && typeof inner === 'string') {
          paths.add(inner.slice(0, 500));
        }
        visit(inner, depth + 1);
      }
    }
  };
  visit(value);
  return [...paths].slice(0, 12);
}

function maybePersistRawResult(sessionId: string, observationId: string, resultText: string): string | undefined {
  if (resultText.length <= 6000) return undefined;
  const dir = rawRoot(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${observationId}.txt`;
  fs.writeFileSync(path.join(dir, fileName), resultText, 'utf-8');
  return `tool-observation-raw:${safeSessionFileName(sessionId)}/${fileName}`;
}

function normalizeCostMicros(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function formatCostMicrosForTelemetry(value: unknown): string {
  const micros = normalizeCostMicros(value) || 0;
  const usd = micros / 1_000_000;
  if (usd <= 0) return '0';
  if (usd >= 1) return usd.toFixed(4);
  if (usd >= 0.01) return usd.toFixed(5);
  return usd.toFixed(7);
}

export function createToolObservation(input: {
  sessionId: string;
  turnId: string;
  stepNum: number;
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: boolean;
  extra?: any;
  data?: any;
  artifacts?: any[];
}): ToolObservation {
  const id = `toolobs_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const resultText = String(input.result || '');
  const argsText = stringifyPreview(input.args || {}, 50_000);
  const rawRef = maybePersistRawResult(input.sessionId, id, resultText);
  const pathsTouched = [...new Set([...extractPaths(input.args), ...extractPaths(input.data), ...extractPaths(input.extra)])].slice(0, 12);
  const exitCode = Number(input.extra?.exitCode ?? input.data?.exitCode);
  const telemetry = input.extra?.telemetry || input.data?.telemetry || {};
  const durationMs = Number(telemetry.durationMs ?? input.extra?.durationMs ?? input.data?.durationMs);
  const startedAt = Number(telemetry.startedAt ?? input.extra?.startedAt ?? input.data?.startedAt);
  const finishedAt = Number(telemetry.finishedAt ?? input.extra?.finishedAt ?? input.data?.finishedAt);
  const argsTokens = Number.isFinite(Number(telemetry.argsTokens)) ? Number(telemetry.argsTokens) : estimateTextTokensForModel(argsText, 'openai');
  const resultTokens = Number.isFinite(Number(telemetry.resultTokens)) ? Number(telemetry.resultTokens) : estimateTextTokensForModel(resultText, 'openai');
  const argsChars = Number.isFinite(Number(telemetry.argsChars)) ? Number(telemetry.argsChars) : argsText.length;
  const resultChars = Number.isFinite(Number(telemetry.resultChars)) ? Number(telemetry.resultChars) : resultText.length;
  const resultBytes = Number.isFinite(Number(telemetry.resultBytes)) ? Number(telemetry.resultBytes) : Buffer.byteLength(resultText, 'utf8');
  const contextCostMicros = normalizeCostMicros(telemetry.contextCostMicros ?? telemetry.context_cost_micros);
  const directCostMicros = normalizeCostMicros(
    telemetry.directCostMicros
    ?? telemetry.direct_cost_micros
    ?? telemetry.costMicros
    ?? telemetry.cost_micros
    ?? input.extra?.costMicros
    ?? input.extra?.cost_micros
    ?? input.data?.costMicros
    ?? input.data?.cost_micros,
  );
  const totalCostMicros = normalizeCostMicros(
    telemetry.totalCostMicros
    ?? telemetry.total_cost_micros
    ?? ((contextCostMicros || directCostMicros) ? (contextCostMicros || 0) + (directCostMicros || 0) : undefined),
  );
  return {
    id,
    sessionId: input.sessionId,
    turnId: input.turnId,
    stepNum: input.stepNum,
    toolName: input.toolName,
    category: inferToolCategory(input.toolName),
    status: input.error ? 'error' : 'ok',
    argsPreview: stringifyPreview(input.args || {}, 900),
    resultPreview: stringifyPreview(resultText, input.error ? 1800 : 1000),
    resultRawRef: rawRef,
    artifacts: Array.isArray(input.artifacts) && input.artifacts.length ? input.artifacts.slice(0, 10) : undefined,
    pathsTouched: pathsTouched.length ? pathsTouched : undefined,
    exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : undefined,
    tokenEstimate: {
      argsTokens,
      resultTokens,
      totalTokens: argsTokens + resultTokens,
      argsChars,
      resultChars,
      resultBytes,
      contextCostMicros,
      directCostMicros,
      totalCostMicros,
      pricingSource: telemetry.pricingSource || telemetry.pricing_source,
      pricingVersion: telemetry.pricingVersion || telemetry.pricing_version,
    },
    createdAt: Date.now(),
  };
}

export function createToolObservationsFromResults(sessionId: string, turnId: string, toolResults: Array<any> = []): ToolObservation[] {
  return toolResults.map((r, idx) => createToolObservation({
    sessionId,
    turnId,
    stepNum: Number(r?.stepNum || idx + 1),
    toolName: String(r?.name || r?.action || 'unknown_tool'),
    args: r?.args,
    result: r?.result ?? r?.stdout ?? r?.data ?? r?.error ?? '',
    error: Boolean(r?.error || r?.success === false),
    extra: r?.extra,
    data: r?.data,
    artifacts: r?.artifacts,
  }));
}

export function persistToolObservations(sessionId: string, observations: ToolObservation[]): void {
  if (!observations.length) return;
  const filePath = observationJsonlPath(sessionId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, observations.map((obs) => JSON.stringify(obs)).join('\n') + '\n', 'utf-8');
}

export function persistToolResultsAsObservations(sessionId: string, turnId: string, toolResults: Array<any> = []): ToolObservation[] {
  const observations = createToolObservationsFromResults(sessionId, turnId, toolResults);
  persistToolObservations(sessionId, observations);
  return observations;
}

export function readToolObservations(sessionId: string, maxObservations = 80): ToolObservation[] {
  const filePath = observationJsonlPath(sessionId);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-Math.max(1, maxObservations));
  const out: ToolObservation[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as ToolObservation);
    } catch {}
  }
  return out;
}

export function readAllToolObservations(maxObservations = 50_000): ToolObservation[] {
  try {
    const root = observationRoot();
    if (!fs.existsSync(root)) return [];
    const files = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(root, entry.name));
    const out: ToolObservation[] = [];
    for (const filePath of files) {
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          out.push(JSON.parse(line) as ToolObservation);
        } catch {}
      }
    }
    out.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const limit = Math.max(1, Math.min(250_000, Math.floor(Number(maxObservations || 50_000))));
    return out.length > limit ? out.slice(out.length - limit) : out;
  } catch {
    return [];
  }
}

function observationPriority(obs: ToolObservation, newestTurnId: string): number {
  let score = 0;
  if (obs.turnId === newestTurnId) score += 30;
  if (obs.status === 'error') score += 80;
  if (obs.category === 'approval') score += 70;
  if (obs.category === 'file') score += /write|edit|delete|rename|copy|mkdir|append|apply_patch/i.test(obs.toolName) ? 55 : 18;
  if (obs.category === 'shell_process') score += obs.status === 'error' ? 40 : 22;
  if (obs.category === 'browser' || obs.category === 'desktop') score += 24;
  if (obs.artifacts?.length) score += 35;
  if (obs.resultRawRef) score += 8;
  score += Math.min(25, Math.floor((obs.createdAt || 0) / 1000) % 25);
  return score;
}

export function formatToolObservationsForContext(observations: ToolObservation[], opts: ObservationContextOptions = {}): string {
  if (!observations.length) return '';
  const includeHeader = opts.includeHeader !== false;
  const maxChars = Number.isFinite(Number(opts.maxChars)) && Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 8000;
  const maxObservations = Math.max(1, Math.min(60, Math.floor(Number(opts.maxObservations || 24))));
  const includeTelemetry = opts.includeTelemetry === true;
  const newestTurnId = observations[observations.length - 1]?.turnId || '';
  const ranked = [...observations]
    .sort((a, b) => observationPriority(b, newestTurnId) - observationPriority(a, newestTurnId) || b.createdAt - a.createdAt)
    .slice(0, maxObservations)
    .sort((a, b) => a.createdAt - b.createdAt);
  const blocks = ranked.map((obs) => {
    const lines = [
      `--- observation ${obs.stepNum}: ${obs.toolName} (${obs.category}, ${obs.status}) ---`,
      obs.pathsTouched?.length ? `paths: ${obs.pathsTouched.join(', ')}` : '',
      obs.artifacts?.length ? `artifacts: ${obs.artifacts.map((a: any) => String(a?.path || a?.url || a?.id || a).slice(0, 180)).join(', ')}` : '',
      Number.isFinite(Number(obs.exitCode)) ? `exit_code: ${obs.exitCode}` : '',
      includeTelemetry && Number.isFinite(Number(obs.durationMs)) ? `duration_ms: ${obs.durationMs}` : '',
      includeTelemetry && obs.tokenEstimate
        ? [
          `token_estimate: args=${obs.tokenEstimate.argsTokens}`,
          `result=${obs.tokenEstimate.resultTokens}`,
          `total=${obs.tokenEstimate.totalTokens}`,
          `result_bytes=${obs.tokenEstimate.resultBytes}`,
          `context_cost_est_usd=${formatCostMicrosForTelemetry(obs.tokenEstimate.contextCostMicros)}`,
          obs.tokenEstimate.directCostMicros ? `direct_cost_est_usd=${formatCostMicrosForTelemetry(obs.tokenEstimate.directCostMicros)}` : '',
          `total_cost_est_usd=${formatCostMicrosForTelemetry(obs.tokenEstimate.totalCostMicros)}`,
          obs.tokenEstimate.pricingSource ? `pricing_source=${obs.tokenEstimate.pricingSource}` : '',
        ].filter(Boolean).join(', ')
        : '',
      obs.argsPreview ? `args: ${obs.argsPreview}` : '',
      obs.resultPreview ? `result: ${obs.resultPreview}` : '',
      obs.resultRawRef ? `raw_ref: ${obs.resultRawRef}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  });
  const block = `${includeHeader ? '[RECENT_TOOL_OBSERVATIONS]\n' : ''}${blocks.join('\n\n')}`;
  return block.length <= maxChars ? block : `${block.slice(0, maxChars)}\n[...tool observations truncated]`;
}

export function getRecentToolObservationsForContext(sessionId: string, opts: ObservationContextOptions = {}): string {
  const lookbackTurns = Math.max(1, Math.min(20, Math.floor(Number(opts.lookbackTurns || 5))));
  const observations = readToolObservations(sessionId, lookbackTurns * 20);
  if (!observations.length) return '';
  const turnIds = [...new Set(observations.map((obs) => obs.turnId).filter(Boolean))].slice(-lookbackTurns);
  const filtered = observations.filter((obs) => turnIds.includes(obs.turnId));
  return formatToolObservationsForContext(filtered, opts);
}

