export const MOBILE_CONNECTION_RECOVERY_PLACEHOLDER = "Connection dropped, but Prometheus may still be working. I'll keep checking and recover the result here.";

export function clearMobileRecoveryPlaceholder(message) {
  if (!message || typeof message !== 'object') return false;
  const currentText = String(message.body?.text || message.content || '').trim();
  if (currentText !== MOBILE_CONNECTION_RECOVERY_PLACEHOLDER) return false;
  if (!message.body || typeof message.body !== 'object') message.body = { sender: '', text: '' };
  message.body.text = '';
  message.content = '';
  return true;
}
