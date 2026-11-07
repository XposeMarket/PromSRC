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
/** Chat payloads can contain nested edited/queued messages; inspect strings, never echo. */
export function payloadContainsRecognizableSecret(value: unknown, depth = 0): boolean {
  if (containsRecognizableSecret(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (depth > 30) return true; // fail closed on malformed/deep chat data
  return Object.values(value).some(item => payloadContainsRecognizableSecret(item, depth + 1));
}
