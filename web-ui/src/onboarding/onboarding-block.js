// The meet & greet prompt asks the model to emit a machine-readable
// [ONBOARDING_COMPLETE]{json}[/ONBOARDING_COMPLETE] block that meet-panel.js
// parses from the raw history. It is a control signal, not reply text, so chat
// renderers hide it. Display-only: stored history keeps the block so the
// onboarding flow can still read it.

const CLOSED_BLOCK_RE = /\s*\[ONBOARDING_COMPLETE\][\s\S]*?\[\/ONBOARDING_COMPLETE\]\s*/g;
// While streaming, the closing tag may not have arrived yet.
const OPEN_TAIL_RE = /\s*\[ONBOARDING_COMPLETE\][\s\S]*$/;

export function stripOnboardingControlBlock(text) {
  const raw = String(text ?? '');
  if (!raw.includes('[ONBOARDING_COMPLETE]')) return raw;
  return raw.replace(CLOSED_BLOCK_RE, '\n\n').replace(OPEN_TAIL_RE, '').trim();
}
