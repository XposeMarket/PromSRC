export type MemoryNoteAttachment = {
  name: string;
  path: string;
  kind: 'image' | 'file';
  mimeType?: string;
  sizeBytes?: number;
};

export type MemoryNoteMeta = {
  id?: string;
  title?: string;
  description?: string;
  createdAt?: string;
  projectId?: string;
  attachments?: MemoryNoteAttachment[];
};

export type ParsedMemoryNote = {
  meta: MemoryNoteMeta;
  body: string;
  hasMeta: boolean;
};

const META_BLOCK = /^<!--\s*PROMETHEUS_MEMORY_META\s*\n([\s\S]*?)\n-->\s*/;

function cleanParagraph(text: string): string {
  return String(text || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripMarkdownTitle(text: string): string {
  return String(text || '').replace(/^#\s+.+$/m, '').trim();
}

function fallbackDescription(content: string): string {
  const withoutTitle = stripMarkdownTitle(content)
    .replace(/^_Created .+?_\s*$/m, '')
    .replace(/^##\s+Attachments[\s\S]*?(?=^##\s|\Z)/im, '')
    .replace(/^##\s+Memory\s*$/im, '')
    .trim();
  const firstBlock = withoutTitle.split(/\n{2,}/).map((part) => part.trim()).find(Boolean) || '';
  return firstBlock.replace(/\n/g, ' ').trim();
}

export function parseMemoryNoteDocument(raw: string): ParsedMemoryNote {
  const source = String(raw || '').replace(/\r/g, '\n');
  const match = source.match(META_BLOCK);
  let meta: MemoryNoteMeta = {};
  let content = source.trim();
  if (match) {
    try {
      meta = JSON.parse(match[1]);
    } catch {
      meta = {};
    }
    content = source.slice(match[0].length).trim();
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (!meta.title && titleMatch?.[1]) meta.title = titleMatch[1].trim();

  const memorySection = content.match(/(?:^|\n)##\s+Memory\s*\n+([\s\S]*)$/i);
  const body = cleanParagraph(memorySection?.[1] || stripMarkdownTitle(content));

  if (!meta.description) {
    const description = fallbackDescription(content);
    if (description && description !== body) meta.description = description;
  }

  const attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
  meta.attachments = attachments
    .map((item): MemoryNoteAttachment => ({
      name: String(item?.name || '').trim(),
      path: String(item?.path || '').replace(/\\/g, '/').trim(),
      kind: item?.kind === 'image' ? 'image' : 'file',
      mimeType: item?.mimeType ? String(item.mimeType).trim() : undefined,
      sizeBytes: Number.isFinite(Number(item?.sizeBytes)) ? Number(item.sizeBytes) : undefined,
    }))
    .filter((item) => item.name && item.path);

  return { meta, body, hasMeta: !!match };
}

export function buildMemoryNoteDocument(input: {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  projectId?: string;
  attachments?: MemoryNoteAttachment[];
  body: string;
}): string {
  const title = String(input.title || 'Untitled memory').trim();
  const description = cleanParagraph(input.description || '');
  const body = cleanParagraph(input.body || '');
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const meta: MemoryNoteMeta = {
    id: input.id,
    title,
    description: description || undefined,
    createdAt: input.createdAt,
    projectId: input.projectId ? String(input.projectId).trim() : undefined,
    attachments: attachments.length ? attachments : undefined,
  };

  const parts = [
    '<!-- PROMETHEUS_MEMORY_META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    `# ${title}`,
    '',
  ];

  if (description) {
    parts.push(description, '');
  }

  parts.push(`_Created ${input.createdAt}_`, '');

  if (attachments.length) {
    parts.push('## Attachments', '');
    attachments.forEach((attachment) => {
      const kindLabel = attachment.kind === 'image' ? 'image' : 'file';
      parts.push(`- ${kindLabel}: ${attachment.name}`);
    });
    parts.push('');
  }

  parts.push('## Memory', '', body || '(no body provided)', '');

  return parts.join('\n');
}
