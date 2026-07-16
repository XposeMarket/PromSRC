import path from 'path';
import { listEntities, readEntity } from './entity-store';
import { readPromptProfileText } from '../prompt-profile-snapshot';

const BUSINESS_KEYWORDS = [
  'business',
  'company',
  'client',
  'customer',
  'prospect',
  'lead',
  'contact',
  'vendor',
  'project',
  'deal',
  'contract',
  'invoice',
  'quote',
  'revenue',
  'sales',
  'outreach',
  'crm',
  'social',
  'marketing',
  'offer',
  'service',
  'product',
  'deadline',
  'follow up',
  'follow-up',
];

function compact(value: string, maxChars: number): string {
  const text = String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
}

function includesBusinessIntent(messageText: string): boolean {
  const text = String(messageText || '').toLowerCase();
  return BUSINESS_KEYWORDS.some((keyword) => text.includes(keyword));
}

function loadBusinessSnapshot(workspacePath: string): string {
  const filePath = path.join(workspacePath, 'BUSINESS.md');
  return compact(readPromptProfileText(filePath), 1600);
}

function scoreEntity(messageText: string, entity: { id: string; name: string; type: string }): number {
  const text = String(messageText || '').toLowerCase();
  const haystacks = [
    entity.id.toLowerCase(),
    entity.name.toLowerCase(),
    entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  ].filter(Boolean);
  let score = 0;
  for (const value of haystacks) {
    if (value && text.includes(value)) score += 4;
  }
  if (text.includes(entity.type)) score += 1;
  return score;
}

function recentEntityEvents(content: string, maxChars = 700): string {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Business Events');
  if (start < 0) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line.trim())) break;
    if (line.trim()) body.push(line);
  }
  return compact(body.slice(-8).join('\n'), maxChars);
}

export function buildCisContextBlock(workspacePath: string, messageText: string, opts: { force?: boolean } = {}): string {
  try {
    const forced = opts.force === true;
    if (!forced && !includesBusinessIntent(messageText)) return '';

    const business = loadBusinessSnapshot(workspacePath);
    const entities = listEntities(workspacePath);
    const scored = entities
      .map((entity) => ({ entity, score: scoreEntity(messageText, entity) }))
      .filter((row) => forced ? row.score > 0 : row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const entityBlocks = scored.map(({ entity }) => {
      try {
        const full = readEntity(workspacePath, entity.type, entity.id);
        const events = recentEntityEvents(full.content);
        return [
          `- ${entity.type}/${entity.id}: ${entity.name}`,
          events ? `  recent_events:\n${events.split(/\r?\n/).map((line) => `    ${line}`).join('\n')}` : '',
        ].filter(Boolean).join('\n');
      } catch {
        return `- ${entity.type}/${entity.id}: ${entity.name}`;
      }
    });

    const parts = [
      '[CIS_CONTEXT]',
      'Business context is generic per-user/company state, not product-default content. Use it only as scoped operating memory.',
      // When business context mode is on (forced), the dedicated [BUSINESS] block
      // already carries BUSINESS.md verbatim — reference it instead of embedding a
      // second full copy. On the keyword-triggered path (mode off) CIS is the only
      // carrier, so embed the snapshot.
      forced
        ? 'business_profile: see the [BUSINESS] block (business context mode is on).'
        : business ? `business_profile:\n${business}` : 'business_profile: BUSINESS.md not found or empty.',
      entityBlocks.length ? `relevant_entities:\n${entityBlocks.join('\n')}` : 'relevant_entities: none matched this turn.',
      'business_memory_routing: company-level facts -> BUSINESS.md; people/clients/projects/vendors/social accounts -> workspace/entities; repeatable workflows -> skills; short-lived events -> notes unless durable.',
    ];
    return parts.join('\n');
  } catch {
    return '';
  }
}
