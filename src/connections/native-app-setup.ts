import type { ConnectionOrchestrator } from './orchestrator';
import { listExtensionDescriptors } from '../extensions/registry';
/** Validates metadata-only correlation before existing typed credential routes save. */
export function nativeAppSetup(orchestrator: ConnectionOrchestrator, attemptId: string, serviceId?: string) {
  const attempt = orchestrator.getAttempt(attemptId);
  if (!attempt || attempt.state !== 'awaiting_secure_input' || attempt.plan?.strategy.adapter !== 'connector-oauth'
    || (serviceId && attempt.serviceId !== serviceId) || Date.now() - Date.parse(attempt.updatedAt) > 15 * 60_000) throw new Error('STALE_OR_MISMATCHED_CONNECTION');
  const descriptor = listExtensionDescriptors().find(item => item.kind === 'connector' && item.id === attempt.serviceId);
  if (!descriptor || descriptor.setup?.authType !== 'oauth') throw new Error('UNSUPPORTED_PLUGIN');
  const fields = descriptor.setup.fields?.filter(field => ['clientId', 'clientSecret'].includes(field.key)) || [];
  if (!fields.some(field => field.key === 'clientId')) throw new Error('OAUTH_APP_SCHEMA_UNAVAILABLE');
  return { serviceId: attempt.serviceId, fields: fields.map(field => ({ ...field, required: field.key === 'clientId' || field.required === true })), attemptId: attempt.id, expiresAt: new Date(Date.parse(attempt.updatedAt) + 15 * 60_000).toISOString() };
}
