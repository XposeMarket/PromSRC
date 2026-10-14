import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../config/config';

export type OperationStatus = 'intent' | 'committed' | 'failed' | 'uncertain';
export interface OperationRecord {
  opId: string; sessionId: string; toolName: string; idempotencyKey: string;
  status: OperationStatus; at: string; resultSummary?: string; error?: string;
}
export interface OperationInput { sessionId: string; toolName: string; args: unknown; idempotencyKey?: string }
const VOLATILE = new Set(['force_reexecute', 'idempotencyKey', 'idempotency_key', 'request_id', 'trace_id', 'final_action_approval_id']);
function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !VOLATILE.has(key) && value[key] !== undefined).map(key => [key, stableValue(value[key])]));
  return value;
}
export function operationIdempotencyKey(sessionId: string, toolName: string, args: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify([sessionId, toolName, stableValue(args)])).digest('hex');
}
/** Pure classification of direct tools and their public wrappers. Schedules/local writes are deliberately excluded. */
export function isExternalSideEffect(toolName: string, args: any = {}): boolean {
  const name = toolName.toLowerCase();
  const action = String(args.action || '').toLowerCase();
  const writeRequest = !['GET', 'HEAD', 'OPTIONS'].includes(String(args.method || args.http_method || 'GET').toUpperCase());
  if (/^connector_.*_api_request$/.test(name)) return writeRequest;
  if (/^connector_.*$/.test(name) && action === 'api_request') return writeRequest;
  if (name === 'connector_gmail') return action === 'send_email';
  if (name === 'connector_gmail_send_email') return true;
  const githubWrites = ['create_pr', 'merge_pr', 'comment', 'create_comment', 'create_issue', 'update_issue', 'update_pr', 'close_pr', 'create_repo'];
  if (name === 'connector_github') return githubWrites.includes(action);
  if (githubWrites.some(a => name === `connector_github_${a}`)) return true;
  if (name === 'x_posts') return ['create_post', 'delete_post', 'repost', 'like'].includes(action);
  if (['x_create_post', 'x_delete_post', 'x_repost', 'x_like', 'x_api_create_post', 'x_api_delete_post', 'x_api_repost', 'x_api_like_post'].includes(name)) return true;
  if (name === 'x_dm') return action === 'send';
  if (['x_send_dm', 'x_send', 'x_api_send_dm'].includes(name)) return true;
  if (name === 'vercel_ops') return action === 'create_deployment' || action.startsWith('delete_') || (action === 'api_request' && writeRequest);
  if (name === 'connector_vercel_create_deployment' || name.startsWith('connector_vercel_delete_')) return true;
  return name === 'vercel_create_deployment' || name.startsWith('vercel_delete_') || (name === 'vercel_api_request' && writeRequest);
}

/** Single gateway writer; synchronous append + fsync puts intent before dispatch and commit before returning. */
export class OperationLedger {
  private records = new Map<string, OperationRecord>();
  constructor(readonly filePath: string, readonly now: () => number = Date.now) {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, 'utf8');
      const lines = text.split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i += 1) {
        let record: OperationRecord;
        try {
          record = JSON.parse(lines[i]) as OperationRecord;
        } catch (err) {
          // A crash mid-append can leave a torn final line. That write never
          // completed, so its dispatch never started: skip it. Corruption anywhere
          // else fails closed, never silently discarding an intent.
          if (i === lines.length - 1 && !text.endsWith('\n')) break;
          throw err;
        }
        if (!record.opId || !record.idempotencyKey || !record.status) throw new Error('Invalid operation ledger record');
        this.records.set(record.opId, record);
      }
    }
  }
  private append(record: OperationRecord): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const fd = fs.openSync(this.filePath, 'a');
    try { fs.writeSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.records.set(record.opId, record);
  }
  beginOperation(input: OperationInput): string {
    const opId = crypto.randomUUID();
    this.append({ opId, sessionId: input.sessionId, toolName: input.toolName,
      idempotencyKey: input.idempotencyKey || operationIdempotencyKey(input.sessionId, input.toolName, input.args),
      status: 'intent', at: new Date(this.now()).toISOString() });
    return opId;
  }
  private finish(opId: string, status: OperationStatus, detail: Partial<OperationRecord> = {}): void {
    const record = this.records.get(opId);
    if (!record) throw new Error(`Unknown operation ${opId}`);
    this.append({ ...record, ...detail, status, at: new Date(this.now()).toISOString() });
  }
  commitOperation(opId: string, resultSummary: string): void { this.finish(opId, 'committed', { resultSummary: resultSummary.slice(0, 2000) }); }
  failOperation(opId: string, error: string): void { this.finish(opId, 'failed', { error: error.slice(0, 2000) }); }
  findOpenOperations(): OperationRecord[] { return [...this.records.values()].filter(r => r.status === 'intent' || r.status === 'uncertain'); }
  markInterruptedOperations(bootTime: number): OperationRecord[] {
    for (const r of this.findOpenOperations()) if (r.status === 'intent' && Date.parse(r.at) < bootTime) this.finish(r.opId, 'uncertain');
    return this.findOpenOperations().filter(r => r.status === 'uncertain');
  }
  refusal(input: OperationInput): string | undefined {
    const key = input.idempotencyKey || operationIdempotencyKey(input.sessionId, input.toolName, input.args);
    const matching = [...this.records.values()].filter(r => r.idempotencyKey === key).reverse();
    const open = matching.find(r => r.status === 'intent' || r.status === 'uncertain');
    if (open) {
      const why = open.status === 'uncertain' && open.error
        ? `previous attempt returned an error (${open.error.slice(0, 160)})`
        : 'no result was recorded (gateway stopped mid-call, or an identical call is still in flight)';
      return `Outcome uncertain after crash or error (op ${open.opId}): ${why}; held for review. Verify externally before retrying, then pass force_reexecute:true to override`;
    }
    const committed = matching.find(r => r.status === 'committed' && this.now() - Date.parse(r.at) < 24 * 60 * 60 * 1000);
    return committed ? `Already executed (op ${committed.opId}) at ${committed.at}; not repeating` : undefined;
  }
  async execute<T extends { error?: boolean; result: any }>(input: OperationInput, run: () => Promise<T>, force = false): Promise<T | { error: true; result: string }> {
    const held = !force && this.refusal(input);
    if (held) return { error: true, result: held };
    const opId = this.beginOperation(input); // No await between check and intent: concurrent dispatch cannot race.
    const result = await run();
    // A transport error may follow a successful remote write: leave intent open, never make it retryable.
    if (!result.error) this.commitOperation(opId, String(result.result ?? ''));
    else this.finish(opId, 'uncertain', { error: String(result.result ?? 'error').slice(0, 2000) });
    return result;
  }
}
let ledger: OperationLedger | undefined;
export function getOperationLedger(): OperationLedger {
  return ledger ||= new OperationLedger(path.join(getConfig().getConfigDir(), 'operations', 'ledger.jsonl'));
}
export const beginOperation = (input: OperationInput): string => getOperationLedger().beginOperation(input);
export const commitOperation = (opId: string, summary: string): void => getOperationLedger().commitOperation(opId, summary);
export const failOperation = (opId: string, error: string): void => getOperationLedger().failOperation(opId, error);
export const findOpenOperations = (): OperationRecord[] => getOperationLedger().findOpenOperations();
export const getUncertainOperations = (): OperationRecord[] => findOpenOperations().filter(r => r.status === 'uncertain');
export function recoverOperationLedger(bootTime = Date.now() - process.uptime() * 1000): OperationRecord[] {
  const uncertain = getOperationLedger().markInterruptedOperations(bootTime);
  for (const r of uncertain) console.warn(`[operation-ledger] Outcome uncertain after crash: op ${r.opId} (${r.toolName}, session ${r.sessionId}); held for external review, not retried`);
  return uncertain;
}
