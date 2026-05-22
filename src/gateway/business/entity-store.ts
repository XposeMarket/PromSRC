import fs from 'fs';
import path from 'path';

export type BusinessEntityType = 'client' | 'project' | 'vendor' | 'contact' | 'social';

export interface BusinessEntitySummary {
  type: BusinessEntityType;
  id: string;
  name: string;
  path: string;
  lastUpdated: string;
  size: number;
}

const ENTITY_DIRS: Record<BusinessEntityType, string> = {
  client: 'clients',
  project: 'projects',
  vendor: 'vendors',
  contact: 'contacts',
  social: 'social',
};

const ENTITY_TYPES = new Set<BusinessEntityType>(Object.keys(ENTITY_DIRS) as BusinessEntityType[]);

export function normalizeEntityType(raw: unknown): BusinessEntityType {
  const value = String(raw || '').trim().toLowerCase().replace(/s$/, '');
  if (!ENTITY_TYPES.has(value as BusinessEntityType)) {
    throw new Error(`Unsupported entity type "${String(raw || '')}". Use client, project, vendor, contact, or social.`);
  }
  return value as BusinessEntityType;
}

export function slugifyEntityId(raw: unknown): string {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!slug) throw new Error('Entity id/name is required.');
  return slug;
}

function workspaceEntitiesDir(workspacePath: string): string {
  return path.join(workspacePath, 'entities');
}

export function getEntityPath(workspacePath: string, typeRaw: unknown, idRaw: unknown): string {
  const type = normalizeEntityType(typeRaw);
  const id = slugifyEntityId(idRaw);
  return path.join(workspaceEntitiesDir(workspacePath), ENTITY_DIRS[type], `${id}.md`);
}

function getTemplatePath(workspacePath: string, type: BusinessEntityType): string {
  return path.join(workspaceEntitiesDir(workspacePath), ENTITY_DIRS[type], '_template.md');
}

function defaultTemplate(type: BusinessEntityType, displayName: string, id: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return [
    `# ${displayName} - ${label} Entity`,
    `# File: entities/${ENTITY_DIRS[type]}/${id}.md`,
    `# Last Updated: ${today}`,
    '',
    '## Overview',
    `- **Name:** ${displayName}`,
    '- **Status:** ',
    '',
    '## Notes',
    '',
    '## Business Events',
  ].join('\n');
}

function entityHeadingName(content: string, fallback: string): string {
  const firstHeading = String(content || '').split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (!firstHeading) return fallback;
  return firstHeading.replace(/^#\s+/, '').replace(/\s+[—-]\s+.+$/, '').trim() || fallback;
}

function templateForEntity(workspacePath: string, type: BusinessEntityType, displayName: string, id: string): string {
  const templatePath = getTemplatePath(workspacePath, type);
  let content = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf-8')
    : defaultTemplate(type, displayName, id);
  const today = new Date().toISOString().slice(0, 10);
  content = content
    .replace(/\[Client Name\]|\[Project Name\]|\[Vendor Name\]|\[Full Name\]|\[Platform\]/g, displayName)
    .replace(/\[client-name\]|\[project-name\]|\[vendor-name\]|\[first-last\]|\[platform\]/g, id)
    .replace(/\[date\]/g, today);
  if (!/## Business Events\b/.test(content)) {
    content = `${content.trimEnd()}\n\n## Business Events\n`;
  }
  return content.trimEnd() + '\n';
}

export function listEntities(workspacePath: string, typeRaw?: unknown): BusinessEntitySummary[] {
  const types = typeRaw ? [normalizeEntityType(typeRaw)] : Array.from(ENTITY_TYPES);
  const out: BusinessEntitySummary[] = [];
  for (const type of types) {
    const dir = path.join(workspaceEntitiesDir(workspacePath), ENTITY_DIRS[type]);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_template.md') continue;
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      const id = entry.name.replace(/\.md$/i, '');
      let name = id;
      try {
        name = entityHeadingName(fs.readFileSync(filePath, 'utf-8'), id);
      } catch {}
      out.push({
        type,
        id,
        name,
        path: path.relative(workspacePath, filePath).replace(/\\/g, '/'),
        lastUpdated: stat.mtime.toISOString(),
        size: stat.size,
      });
    }
  }
  return out.sort((a, b) => `${a.type}/${a.id}`.localeCompare(`${b.type}/${b.id}`));
}

export function readEntity(workspacePath: string, typeRaw: unknown, idRaw: unknown): { summary: BusinessEntitySummary; content: string } {
  const type = normalizeEntityType(typeRaw);
  const id = slugifyEntityId(idRaw);
  const filePath = getEntityPath(workspacePath, type, id);
  if (!fs.existsSync(filePath)) throw new Error(`Entity not found: ${type}/${id}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const stat = fs.statSync(filePath);
  return {
    summary: {
      type,
      id,
      name: entityHeadingName(content, id),
      path: path.relative(workspacePath, filePath).replace(/\\/g, '/'),
      lastUpdated: stat.mtime.toISOString(),
      size: stat.size,
    },
    content,
  };
}

export function writeEntity(
  workspacePath: string,
  typeRaw: unknown,
  idRaw: unknown,
  contentRaw: unknown,
): { summary: BusinessEntitySummary; created: boolean } {
  const type = normalizeEntityType(typeRaw);
  const id = slugifyEntityId(idRaw);
  const content = String(contentRaw || '').trimEnd();
  if (!content.trim()) throw new Error('Entity content is required.');
  const filePath = getEntityPath(workspacePath, type, id);
  const created = !fs.existsSync(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, 'utf-8');
  return { summary: readEntity(workspacePath, type, id).summary, created };
}

export function ensureEntity(
  workspacePath: string,
  typeRaw: unknown,
  idRaw: unknown,
  displayNameRaw?: unknown,
): { summary: BusinessEntitySummary; created: boolean; content: string } {
  const type = normalizeEntityType(typeRaw);
  const id = slugifyEntityId(idRaw);
  const displayName = String(displayNameRaw || '').trim() || id.replace(/-/g, ' ');
  const filePath = getEntityPath(workspacePath, type, id);
  let created = false;
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, templateForEntity(workspacePath, type, displayName, id), 'utf-8');
    created = true;
  }
  const { summary, content } = readEntity(workspacePath, type, id);
  return { summary, created, content };
}

export function appendEntityEvent(
  workspacePath: string,
  typeRaw: unknown,
  idRaw: unknown,
  eventRaw: unknown,
  opts: { displayName?: unknown; source?: unknown; confidence?: unknown } = {},
): { summary: BusinessEntitySummary; created: boolean; appended: string } {
  const type = normalizeEntityType(typeRaw);
  const id = slugifyEntityId(idRaw);
  const event = String(eventRaw || '').trim();
  if (!event) throw new Error('Event content is required.');
  const ensured = ensureEntity(workspacePath, type, id, opts.displayName);
  const filePath = getEntityPath(workspacePath, type, id);
  let content = ensured.content.trimEnd();
  if (!/## Business Events\b/.test(content)) {
    content += '\n\n## Business Events';
  }
  const today = new Date().toISOString().slice(0, 10);
  const suffixParts = [
    opts.confidence ? `confidence: ${String(opts.confidence)}` : '',
    opts.source ? `source: ${String(opts.source)}` : '',
  ].filter(Boolean);
  const appended = `- ${today}: ${event}${suffixParts.length ? ` (${suffixParts.join('; ')})` : ''}`;
  content += `\n${appended}\n`;
  fs.writeFileSync(filePath, content, 'utf-8');
  return { summary: readEntity(workspacePath, type, id).summary, created: ensured.created, appended };
}
