// Version 1: narrow, recognizable credential formats only. Not a general secret detector.
// No entropy/JWT/password/opaque-X-token guessing. Keep aligned with the gateway module (test enforced).
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
export function containsRecognizableSecret(text) {
  return SOURCES.some(source => new RegExp(source).test(String(text || '')));
}
export function removeRecognizableSecrets(text) {
  return SOURCES.reduce((value, source) => value.replace(new RegExp(source, 'g'), '[secret removed]'), String(text || ''));
}

export function assertSafeChatRequest(path, body) {
  if (!/^\/api\/(chat(?:\/|$)|sessions\/[^/]+\/(?:messages|history|edit-rerun-reset|steer|queue|send|edit)(?:\/|$))/.test(String(path || '').split('?')[0])) return;
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (containsRecognizableSecret(text)) {
    globalThis.dispatchEvent?.(new CustomEvent('prom-protected-entry-required'));
    throw new Error('Recognizable credential blocked. Remove it or use Add secret.');
  }
}
