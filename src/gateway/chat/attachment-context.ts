import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../../config/config';

const mammoth: any = require('mammoth');
const pdfParse: any = require('pdf-parse');
const XLSX: any = require('xlsx');

export type RuntimeVisionAttachment = {
  base64: string;
  mimeType: string;
  name: string;
};

type AttachmentPreview = {
  kind?: string;
  name?: string;
  ext?: string;
  mimeType?: string;
  workspacePath?: string;
  path?: string;
  filePath?: string;
  dataUrl?: string;
  size?: number;
  bytes?: number;
  [key: string]: any;
};

export type AttachmentRuntimeContext = {
  block: string;
  visionAttachments: RuntimeVisionAttachment[];
  attachmentCount: number;
};

type AttachmentContextOptions = {
  maxAttachments?: number;
  maxTotalPreviewChars?: number;
  maxPreviewCharsPerFile?: number;
  maxVisionImages?: number;
  maxVisionBytesPerImage?: number;
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.js', '.jsx', '.ts', '.tsx',
  '.css', '.scss', '.html', '.htm', '.xml', '.yml', '.yaml', '.toml', '.ini', '.env', '.log',
  '.py', '.ps1', '.sh', '.bat', '.sql', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go',
  '.rs', '.rb', '.php', '.swift', '.kt',
]);

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  const text = String(value || '');
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, Math.max(0, maxChars)).trimEnd(), truncated: true };
}

function normalizeMimeType(filePath: string, explicit?: string): string {
  const value = String(explicit || '').trim();
  if (value) return value;
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

function formatBytes(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'unknown size';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveAttachmentPath(rawPath: string): { absPath: string; relPath: string } | null {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return null;
  const workspaceRoot = getConfig().getWorkspacePath();
  const absPath = path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(workspaceRoot, trimmed));
  const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return null;
  return { absPath, relPath };
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = String(dataUrl || '').trim().match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1] || 'application/octet-stream', base64: match[2] || '' };
}

function isImageAttachment(mimeType: string, ext: string): boolean {
  return mimeType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg'].includes(ext);
}

function isTextLike(mimeType: string, ext: string): boolean {
  return mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(ext);
}

async function extractTextPreview(absPath: string, mimeType: string, ext: string, maxChars: number): Promise<string> {
  if (isTextLike(mimeType, ext)) {
    const raw = await fs.promises.readFile(absPath, 'utf-8');
    const preview = truncateText(raw, maxChars);
    return `${preview.text}${preview.truncated ? '\n...[truncated]' : ''}`;
  }

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const parsed = await pdfParse(await fs.promises.readFile(absPath), { max: 8 });
    const preview = truncateText(String(parsed?.text || '').replace(/\n{3,}/g, '\n\n').trim(), maxChars);
    return `${preview.text}${preview.truncated ? '\n...[truncated]' : ''}`;
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: absPath });
    const preview = truncateText(String(result?.value || '').replace(/\n{3,}/g, '\n\n').trim(), maxChars);
    return `${preview.text}${preview.truncated ? '\n...[truncated]' : ''}`;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(absPath, { cellDates: true });
    const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames.slice(0, 3) : [];
    const parts: string[] = [];
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      const rows = String(csv || '').split(/\r?\n/).slice(0, 25).join('\n');
      parts.push(`[Sheet: ${sheetName}]\n${rows}`);
    }
    const preview = truncateText(parts.join('\n\n'), maxChars);
    return `${preview.text}${preview.truncated ? '\n...[truncated]' : ''}`;
  }

  return '';
}

function createVisionAttachmentFromDataUrl(
  preview: AttachmentPreview,
  mimeType: string,
  maxVisionBytesPerImage: number,
): RuntimeVisionAttachment | null {
  const parsed = parseDataUrl(String(preview.dataUrl || ''));
  if (!parsed || !parsed.mimeType.startsWith('image/')) return null;
  const estimatedBytes = Math.floor((parsed.base64.length * 3) / 4);
  if (estimatedBytes > maxVisionBytesPerImage) return null;
  return {
    base64: parsed.base64,
    mimeType: parsed.mimeType || mimeType,
    name: String(preview.name || 'attached-image').trim() || 'attached-image',
  };
}

async function createVisionAttachmentFromFile(
  absPath: string,
  name: string,
  mimeType: string,
  maxVisionBytesPerImage: number,
): Promise<RuntimeVisionAttachment | null> {
  const stat = await fs.promises.stat(absPath);
  if (!stat.isFile() || stat.size > maxVisionBytesPerImage) return null;
  return {
    base64: (await fs.promises.readFile(absPath)).toString('base64'),
    mimeType,
    name,
  };
}

export async function buildAttachmentRuntimeContext(
  rawPreviews: unknown,
  options: AttachmentContextOptions = {},
): Promise<AttachmentRuntimeContext> {
  const previews = (Array.isArray(rawPreviews) ? rawPreviews : [])
    .filter((value) => value && typeof value === 'object')
    .slice(0, Math.max(1, Math.floor(Number(options.maxAttachments) || 8))) as AttachmentPreview[];

  if (!previews.length) return { block: '', visionAttachments: [], attachmentCount: 0 };

  const maxTotalPreviewChars = Math.max(1000, Math.floor(Number(options.maxTotalPreviewChars) || 12000));
  const maxPreviewCharsPerFile = Math.max(500, Math.floor(Number(options.maxPreviewCharsPerFile) || 5000));
  const maxVisionImages = Math.max(0, Math.floor(Number(options.maxVisionImages) || 3));
  const maxVisionBytesPerImage = Math.max(128 * 1024, Math.floor(Number(options.maxVisionBytesPerImage) || 4 * 1024 * 1024));

  const lines: string[] = [
    `[ATTACHMENTS AVAILABLE]`,
    `The user attached ${previews.length} file(s). Use the extracted previews below when enough; use the exact paths with tools for full inspection. For images, vision inputs may be attached to this turn when size allows; otherwise call analyze_image with the path. Do not claim you inspected full contents unless a preview or tool result supports it.`,
  ];
  const visionAttachments: RuntimeVisionAttachment[] = [];
  let remainingPreviewChars = maxTotalPreviewChars;

  for (let index = 0; index < previews.length; index += 1) {
    const preview = previews[index];
    const rawPath = String(preview.workspacePath || preview.path || preview.filePath || '').trim();
    const resolved = resolveAttachmentPath(rawPath);
    const name = String(preview.name || (resolved ? path.basename(resolved.absPath) : `attachment-${index + 1}`)).trim();
    const ext = String(preview.ext || path.extname(name) || (resolved ? path.extname(resolved.absPath) : '')).toLowerCase();
    const mimeType = normalizeMimeType(resolved?.absPath || name, preview.mimeType);
    const kind = String(preview.kind || (isImageAttachment(mimeType, ext) ? 'image' : 'file')).trim() || 'file';
    let stat: fs.Stats | null = null;
    if (resolved) {
      try {
        stat = await fs.promises.stat(resolved.absPath);
      } catch {
        stat = null;
      }
    }

    lines.push('');
    lines.push(`${index + 1}. ${name}`);
    lines.push(`   Kind: ${kind}; MIME: ${mimeType}; Size: ${formatBytes(preview.size ?? preview.bytes ?? stat?.size)}`);
    if (resolved) {
      lines.push(`   Workspace path: ${resolved.relPath}`);
    } else if (rawPath) {
      lines.push(`   Path note: ${rawPath} could not be resolved inside the workspace.`);
    }

    if (isImageAttachment(mimeType, ext)) {
      let addedVision = false;
      if (visionAttachments.length < maxVisionImages) {
        const fromDataUrl = createVisionAttachmentFromDataUrl(preview, mimeType, maxVisionBytesPerImage);
        if (fromDataUrl) {
          visionAttachments.push(fromDataUrl);
          addedVision = true;
        } else if (resolved && stat?.isFile()) {
          const fromFile = await createVisionAttachmentFromFile(resolved.absPath, name, mimeType, maxVisionBytesPerImage);
          if (fromFile) {
            visionAttachments.push(fromFile);
            addedVision = true;
          }
        }
      }
      lines.push(addedVision
        ? `   Visual preview: attached to the model as an image for this turn.`
        : `   Visual preview: not embedded because of size/count limits; use analyze_image with the workspace path.`);
      continue;
    }

    if (!resolved || !stat?.isFile()) {
      lines.push(`   Preview: file is not available for server-side extraction.`);
      continue;
    }

    if (remainingPreviewChars <= 0) {
      lines.push(`   Preview: omitted because the attachment preview budget was reached.`);
      continue;
    }

    try {
      const maxForThisFile = Math.min(maxPreviewCharsPerFile, remainingPreviewChars);
      const extracted = await extractTextPreview(resolved.absPath, mimeType, ext, maxForThisFile);
      if (extracted.trim()) {
        const bounded = truncateText(extracted, maxForThisFile);
        remainingPreviewChars -= bounded.text.length;
        lines.push(`   Extracted preview:\n${bounded.text.split(/\r?\n/).map((line) => `   ${line}`).join('\n')}${bounded.truncated ? '\n   ...[truncated]' : ''}`);
      } else {
        lines.push(`   Preview: no extractable text preview available; use file tools if detailed inspection is needed.`);
      }
    } catch (err: any) {
      lines.push(`   Preview: extraction failed (${String(err?.message || err).slice(0, 220)}). Use file tools if needed.`);
    }
  }

  return {
    block: lines.join('\n').trim(),
    visionAttachments,
    attachmentCount: previews.length,
  };
}

export function appendAttachmentContextToMessage(message: string, contextBlock: string): string {
  const base = String(message || '').trim();
  const block = String(contextBlock || '').trim();
  if (!block) return base;
  return `${base}\n\n${block}`;
}
