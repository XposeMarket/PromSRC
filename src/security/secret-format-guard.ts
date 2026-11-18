// Version 1: narrow known formats only. UI parity enforced by test-protected-plugin-input.
const SOURCES = [
  '\\bsk-(?:ant|proj|svcacct|admin)-[A-Za-z0-9_-]{16,}',
  '\\bsk-[A-Za-z0-9]{20,}',
  '\\bgh[pousr]_[A-Za-z0-9]{30,}',
  '\\bgithub_pat_[A-Za-z0-9_]{40,}',
  '\\bxai-[A-Za-z0-9]{30,}',
  '\\bAIza[0-9A-Za-z_-]{35}',
  '\\bxox[abprs]-[A-Za-z0-9-]{10,}',
  '\\bvercel_pat_[A-Za-z0-9_]{20,}',
];
export function containsRecognizableSecret(text: unknown): boolean {
  return typeof text === 'string' && SOURCES.some(source => new RegExp(source).test(text));
}
// Keep media classification/traversal aligned with the browser guard (test enforced).
function isRasterBytes(key: string, value: unknown, parent: Record<string, unknown>): boolean {
  if ((key !== 'base64' && key !== 'dataUrl') || typeof value !== 'string') return false;
  const mime = parent.mimeType;
  if (typeof mime !== 'string' || !/^image\/(png|jpeg|gif|webp)$/.test(mime)) return false;
  let bytes = value;
  if (bytes.startsWith('data:')) {
    const prefix = `data:${mime};base64,`;
    if (!bytes.startsWith(prefix)) return false;
    bytes = bytes.slice(prefix.length);
  } else if (key === 'dataUrl') return false;
  if (!bytes || bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(bytes)) return false;
  try {
    const head = atob(bytes.slice(0, 24));
    if (mime === 'image/png') return head.startsWith('\x89PNG\r\n\x1a\n');
    if (mime === 'image/jpeg') return head.startsWith('\xff\xd8\xff');
    if (mime === 'image/gif') return /^GIF8[79]a/.test(head);
    return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  } catch { return false; }
}

/** Inspect text and metadata, not opaque raster transport bytes. Never echo input. */
export function payloadContainsRecognizableSecret(value: unknown, depth = 0, attachmentArray = false, attachmentItem = false): boolean {
  if (containsRecognizableSecret(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (depth > 30) return true; // fail closed on malformed/deep chat data
  if (Array.isArray(value)) return value.some(item => payloadContainsRecognizableSecret(item, depth + 1, false, attachmentArray));
  return Object.entries(value).some(([key, item]) => {
    if (containsRecognizableSecret(key)) return true;
    if (attachmentItem && isRasterBytes(key, item, value as Record<string, unknown>)) return false;
    return payloadContainsRecognizableSecret(item, depth + 1, key === 'attachments' || key === 'attachmentPreviews');
  });
}
