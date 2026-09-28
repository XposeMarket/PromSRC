/**
 * trigger-rule-input.ts - friendly (snake_case / flat) rule input -> TriggerRule,
 * shared by the /api/triggers admin routes and the trigger_ops agent tool, plus
 * the trigger_ops executor itself.
 */
import {
  TRIGGER_CONTRACT_VERSION,
  type TriggerAction,
  type TriggerActionKind,
  type TriggerCondition,
  type TriggerDispatchSummary,
  type TriggerRule,
  type TriggerSourceKind,
} from './trigger-types';
import { getTriggerService } from './trigger-service';
import { publicEndpointView } from './webhook-endpoints';
import { manualTriggerEvent, webhookTriggerEvent } from './trigger-adapters';

const ACTION_KINDS: TriggerActionKind[] = ['wake', 'agent', 'task', 'team', 'notify'];
const SOURCES: TriggerSourceKind[] = ['webhook', 'schedule', 'heartbeat', 'event_queue', 'internal_watch', 'connector', 'manual'];
const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'in'];

function list(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const out = arr.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 50);
  return out.length ? out : undefined;
}

function slug(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function conditions(value: unknown): TriggerCondition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 32).map((raw: any) => {
    const operator = String(raw?.operator || raw?.op || 'equals').trim();
    if (!OPERATORS.includes(operator)) throw new Error(`Unknown condition operator "${operator}". Use one of: ${OPERATORS.join(', ')}.`);
    let field = String(raw?.field || '').trim();
    if (!field) throw new Error('Each condition needs a field, e.g. "payload.pull_request.base.ref".');
    // Friendly: allow "pull_request.draft" as shorthand for "payload.pull_request.draft".
    if (!/^(payload|subject|eventType|source|sourceId|metadata|dedupeKey)(\.|$)/.test(field)) field = `payload.${field}`;
    return { field, operator: operator as TriggerCondition['operator'], value: raw?.value };
  });
}

export function buildTriggerRuleFromInput(input: Record<string, any>, existing: TriggerRule | null): TriggerRule {
  const now = Date.now();
  const actionIn = (input.action && typeof input.action === 'object') ? input.action : {};
  const kind = String(input.action_kind || actionIn.kind || existing?.action.kind || '').trim() as TriggerActionKind;
  if (!ACTION_KINDS.includes(kind)) throw new Error(`action_kind must be one of: ${ACTION_KINDS.join(', ')}.`);

  const matcherIn = (input.matcher && typeof input.matcher === 'object') ? input.matcher : {};
  const endpointIds = list(input.endpoint_ids ?? input.endpoint_id ?? input.source_ids ?? matcherIn.sourceIds);
  const sources = (list(input.sources ?? matcherIn.sources) as TriggerSourceKind[] | undefined) || (endpointIds ? ['webhook'] : undefined);
  for (const s of sources || []) if (!SOURCES.includes(s)) throw new Error(`Unknown source "${s}". Use one of: ${SOURCES.join(', ')}.`);
  const hasMatcherInput = ['endpoint_ids', 'endpoint_id', 'source_ids', 'sources', 'event_types', 'conditions', 'matcher'].some((k) => input[k] !== undefined);
  const matcher = hasMatcherInput || !existing ? {
    sources,
    sourceIds: endpointIds,
    eventTypes: list(input.event_types ?? matcherIn.eventTypes),
    conditions: conditions(input.conditions ?? matcherIn.conditions),
  } : existing.matcher;
  if (!existing && !matcher.sources?.length && !matcher.sourceIds?.length && !matcher.eventTypes?.length) {
    throw new Error('A rule needs at least one of endpoint_ids, sources, or event_types so it does not match every event.');
  }

  const deliveryIn = input.delivery && typeof input.delivery === 'object' ? input.delivery : {};
  const delivery = {
    ...(existing?.action.delivery || {}),
    ...(input.report_session !== undefined || deliveryIn.target !== undefined ? { target: String(input.report_session ?? deliveryIn.target ?? '').trim() || undefined } : {}),
    ...(input.delivery_channel !== undefined || deliveryIn.channel !== undefined ? { channel: String(input.delivery_channel ?? deliveryIn.channel ?? '').trim() || undefined } : {}),
    ...(input.only_on_failure !== undefined ? { onlyOnFailure: input.only_on_failure === true } : {}),
  };
  const action: TriggerAction = {
    ...(existing?.action || {}),
    ...actionIn,
    kind,
    targetId: String(input.target_id ?? actionIn.targetId ?? existing?.action.targetId ?? '').trim() || undefined,
    prompt: String(input.prompt ?? actionIn.prompt ?? existing?.action.prompt ?? '').trim() || undefined,
    model: String(input.model ?? actionIn.model ?? existing?.action.model ?? '').trim() || undefined,
    delivery: Object.values(delivery).some((v) => v !== undefined) ? delivery : undefined,
  };
  if ((kind === 'team' || kind === 'task') && !action.targetId) throw new Error(`${kind} rules need target_id (${kind === 'team' ? 'team id' : 'scheduled job id'}).`);
  if (kind === 'agent' && !action.prompt) throw new Error('agent rules need a prompt. Use {{payload.x.y}} placeholders to pull in event fields.');

  const name = String(input.name ?? existing?.name ?? '').trim();
  const id = String(input.id || input.rule_id || existing?.id || slug(name) || `rule-${now.toString(36)}`).trim();
  return {
    version: TRIGGER_CONTRACT_VERSION,
    id,
    name: name || id,
    enabled: input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled !== false,
    matcher,
    action,
    cooldownMs: input.cooldown_seconds !== undefined ? Math.max(0, Number(input.cooldown_seconds) || 0) * 1000 : existing?.cooldownMs,
    priority: input.priority !== undefined ? Number(input.priority) : existing?.priority,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function summarizeDispatch(summary: TriggerDispatchSummary): Record<string, unknown> {
  return {
    eventId: summary.event.id,
    eventType: summary.event.eventType,
    matchedRules: summary.matchedRuleIds,
    runs: summary.runs.map((run) => ({
      runId: run.runId,
      rule: run.ruleId,
      action: run.actionKind,
      status: run.status,
      skipReason: run.skipReason,
      result: run.result?.result || run.result?.error,
      sessionId: run.result?.sessionId,
    })),
  };
}

function ok(payload: Record<string, unknown>): string {
  return JSON.stringify({ success: true, ...payload }, null, 2);
}

/** Executes the trigger_ops agent tool. Returns [resultText, isError]. */
export async function executeTriggerOps(args: Record<string, any>, sessionId: string): Promise<[string, boolean]> {
  const svc = getTriggerService();
  if (!svc) return ['Trigger service is not initialized on this gateway.', true];
  const action = String(args.action || '').trim().toLowerCase();
  const base = svc.endpoints.getPublicBaseUrl();
  try {
    switch (action) {
      case 'list': {
        return [ok({
          publicBaseUrl: base || null,
          endpoints: svc.endpoints.list().map((ep) => publicEndpointView(ep, { baseUrl: base })),
          rules: svc.runtime.listRules().map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, matcher: r.matcher, action: { kind: r.action.kind, targetId: r.action.targetId, model: r.action.model, delivery: r.action.delivery, prompt: (r.action.prompt || '').slice(0, 300) }, cooldownMs: r.cooldownMs })),
        }), false];
      }
      case 'create_endpoint': {
        const ep = svc.endpoints.create({ id: args.endpoint_id || args.id, name: args.name, kind: args.kind, description: args.description });
        return [ok({ endpoint: publicEndpointView(ep, { reveal: true, baseUrl: base }), note: base ? 'Give the sender token_url, or hmac_url plus the secret (GitHub: Content type application/json, Secret = secret).' : 'No public_base_url set; call set_public_url first so the URLs are absolute.' }), false];
      }
      case 'show_endpoint': {
        const ep = svc.endpoints.get(String(args.endpoint_id || args.id || ''));
        if (!ep) return [`Webhook endpoint not found: ${args.endpoint_id || args.id}`, true];
        return [ok({ endpoint: publicEndpointView(ep, { reveal: args.reveal === true, baseUrl: base }) }), false];
      }
      case 'update_endpoint': {
        const ep = svc.endpoints.update(String(args.endpoint_id || args.id || ''), { name: args.name, enabled: args.enabled, description: args.description, kind: args.kind, rotateSecret: args.rotate_secret === true });
        return [ok({ endpoint: publicEndpointView(ep, { reveal: args.rotate_secret === true, baseUrl: base }) }), false];
      }
      case 'delete_endpoint':
        return [ok({ deleted: svc.endpoints.delete(String(args.endpoint_id || args.id || '')) }), false];
      case 'set_public_url':
        return [ok({ publicBaseUrl: svc.endpoints.setPublicBaseUrl(String(args.public_base_url || args.url || '')) }), false];
      case 'create_rule':
      case 'update_rule': {
        const existing = action === 'update_rule' ? svc.runtime.getRule(String(args.rule_id || args.id || '')) : null;
        if (action === 'update_rule' && !existing) return [`Rule not found: ${args.rule_id || args.id}`, true];
        const input = { ...args };
        // Default report target for agent/notify rules: the chat that created the rule.
        if (!existing && input.report_session === undefined && !(input.delivery && input.delivery.target) && ['agent', 'notify', 'wake'].includes(String(input.action_kind || ''))) {
          input.report_session = sessionId;
        }
        const rule = svc.runtime.upsertRule(buildTriggerRuleFromInput(input, existing));
        return [ok({ rule }), false];
      }
      case 'delete_rule':
        return [ok({ deleted: svc.runtime.deleteRule(String(args.rule_id || args.id || '')) }), false];
      case 'runs':
        return [ok({ runs: svc.runtime.store.listRuns(Number(args.limit) || 20) }), false];
      case 'test': {
        const event = args.endpoint_id
          ? webhookTriggerEvent({ provider: String(args.endpoint_id), deliveryId: `test_${Date.now()}`, eventType: String(args.event_type || 'test'), payload: args.payload || {} })
          : manualTriggerEvent({ eventType: String(args.event_type || 'run'), payload: args.payload || {}, subject: args.subject });
        return [ok(summarizeDispatch(await svc.runtime.dispatch(event))), false];
      }
      default:
        return ['trigger_ops action must be one of: list, create_endpoint, show_endpoint, update_endpoint, delete_endpoint, set_public_url, create_rule, update_rule, delete_rule, runs, test.', true];
    }
  } catch (error: any) {
    return [`trigger_ops(${action}) error: ${String(error?.message || error)}`, true];
  }
}
