// mobile-model-badge.js ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â interactive header model badge for Prometheus Mobile.
//
// The header used to show a static "Online" pill. It now shows the *current
// main-chat model* (truncated to a friendly short name) while keeping the same
// green/red gateway online/offline dot.
//
//   ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ TAP            ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ reasoning / thinking-level sheet for the ACTIVE provider
//                      (mirrors the desktop composer reasoning controls).
//   ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ PRESS-AND-HOLD ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ haptic buzz + quick providerÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢model switch sheet, limited
//                      to providers the user actually has saved credentials for.
//
// Haptics: iOS Safari has no Web Vibration API. The working trick (per the
// 2026 iOS 26.5 discussion) is a *native* `<input type="checkbox" switch>`:
// a real tap that toggles it emits a system haptic. We embed one, invisibly,
// inside every badge so the physical touch buzzes natively, and we also fire
// `navigator.vibrate` (Android) + a programmatic toggle at the long-press
// threshold as best-effort. All paths degrade silently.

import { mobileGatewayFetch } from './mobile-api.js';
import {
  reasoningSelectorOptions,
  formatReasoningSelectorLabel,
  supportsFastSpeed,
} from '../reasoning-capabilities.js';
import { formatModelDisplayName, formatModelWithReasoning } from '../model-display.js';
import { renderReasoningSelector } from '../components/reasoning-selector.js';

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Provider metadata (mirrors web-ui/src/components/agent-model-picker.js) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const BUILTIN_LABELS = {
  ollama: 'Ollama (local)',
  llama_cpp: 'llama.cpp (local)',
  lm_studio: 'LM Studio (local)',
  openai: 'OpenAI',
  openai_codex: 'OpenAI Codex',
  anthropic: 'Anthropic Claude',
  perplexity: 'Perplexity',
  gemini: 'Google Gemini',
  xai: 'xAI Grok',
};

const BUILTIN_STATIC_MODELS = {
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  xai: ['grok-4.6', 'grok-4.5', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.3-latest', 'grok-latest', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent', 'grok-build-0.1'],
};

// Reasoning controls per provider (mirrors mobile-settings renderProviderFields).
const REASONING_EFFORT_PROVIDERS = new Set(['openai', 'openai_codex', 'perplexity', 'xai']);
const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const PERPLEXITY_EFFORT_OPTIONS = ['', 'low', 'medium', 'high'];
const XAI_EFFORT_OPTIONS = ['', 'none', 'low', 'medium', 'high'];
const XAI_MULTI_AGENT_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh'];
const ANTHROPIC_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Caches ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
let _llmCache = null;            // full llm config { provider, providers }
let _catalogCache = null;        // [{ id, name, runtime, ... }]
let _credentialedIds = null;     // [providerId, ...]
let _mobileDraftModelRoute = null; // Unsaved new-chat override; never writes Settings.
let _subagentReasoningContext = null;

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Friendly model-name truncation ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// claude-haiku-4-5-20251001 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ "Claude Haiku 4.5"
// gpt-5.5 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ "GPT 5.5"   Ãƒâ€šÃ‚Â·   grok-4.20-reasoning ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ "Grok 4.20"
export function prettifyModelName(model, provider) {
  return formatModelDisplayName(model, provider);
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Haptic feedback ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const _hapticGestureDisposers = new Set();

export function disposeMobileHapticGestureSurfaces() {
  for (const dispose of Array.from(_hapticGestureDisposers)) {
    try { dispose(); } catch {}
  }
  _hapticGestureDisposers.clear();
}

function _ensureHapticSwitch() {
  let sw = document.getElementById('pm-haptic-switch');
  if (!sw) {
    sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.setAttribute('switch', '');     // iOS native switch styling = haptic on toggle
    sw.id = 'pm-haptic-switch';
    sw.setAttribute('aria-hidden', 'true');
    sw.tabIndex = -1;
    sw.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(sw);
  }
  return sw;
}

export function pmHaptic(strength = 12) {
  try {
    const haptics = window.Capacitor?.Plugins?.Haptics || window.Haptics;
    if (haptics?.selectionChanged) {
      haptics.selectionChanged();
      return;
    }
    if (haptics?.impact) {
      haptics.impact({ style: strength >= 16 ? 'medium' : 'light' });
      return;
    }
  } catch {}
  try {
    const tgHaptics = window.Telegram?.WebApp?.HapticFeedback;
    if (tgHaptics?.selectionChanged) {
      tgHaptics.selectionChanged();
      return;
    }
    if (tgHaptics?.impactOccurred) {
      tgHaptics.impactOccurred(strength >= 16 ? 'medium' : 'light');
      return;
    }
  } catch {}
  try { if (navigator.vibrate) navigator.vibrate(strength); } catch {}
  // Best effort on iOS web. Physical clicks on native switch inputs can haptic;
  // synthetic clicks usually cannot, but doing this synchronously during a touch
  // event is the only web-only fallback available for drag boundary ticks.
  try {
    const sw = _ensureHapticSwitch();
    sw.click?.();
    sw.checked = !sw.checked;
  } catch {}
}

// iOS Safari only emits the useful little ticks while the finger is moving
// over a real `input[switch]`. Calling `.click()` on an off-screen input is not
// enough on current iOS releases. Keep the workaround scoped to the gesture
// surface so the rest of the mobile DOM does not need to be wrapped or
// re-parented. This follows the same moving-switch idea as
// ios-vibrator-pro-max, while preserving Prometheus' existing pointer math.
export function attachMobileHapticGestureSurface(surface, handlers = {}) {
  if (!surface || typeof document === 'undefined') return () => {};

  const proxy = document.createElement('label');
  const input = document.createElement('input');
  proxy.className = 'pm-haptic-gesture-surface';
  const isTabbarGestureSurface = surface.classList.contains('pm-tabbar');
  if (isTabbarGestureSurface) proxy.classList.add('pm-tabbar-haptic-gesture-surface');
  proxy.setAttribute('aria-hidden', 'true');
  proxy.tabIndex = -1;
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.className = 'pm-haptic-gesture-input';
  input.style.cssText = [
    'all: revert',
    'position: absolute',
    'inset: 0',
    'width: 100%',
    'height: 100%',
    'margin: 0',
    'opacity: 0',
    'touch-action: none',
  ].join(';');
  proxy.appendChild(input);
  proxy.style.cssText = [
    'all: unset',
    'position: fixed',
    `z-index: ${isTabbarGestureSurface ? '6' : '2147483647'}`,
    'overflow: hidden',
    'opacity: 0',
    'pointer-events: auto',
    'touch-action: none',
    'border-radius: 999px',
  ].join(';');

  let pointerId = null;
  let flippedDirection = false;
  let disposed = false;
  let surfaceStateObserver = null;

  // iOS only recognizes the switch as a haptic trigger when its direction is
  // changed *before* it is moved underneath the active finger.
  const nativeHaptic = (event, compact = true) => {
    if (disposed || pointerId == null) return;
    flippedDirection = !flippedDirection;
    input.style.direction = flippedDirection ? 'rtl' : 'ltr';
    positionSurface(event, compact);
  };

  const positionSurface = (event, compact = false) => {
    const rect = surface.getBoundingClientRect?.();
    if (!compact && rect && rect.width > 0 && rect.height > 0) {
      proxy.style.left = `${rect.left}px`;
      proxy.style.top = `${rect.top}px`;
      proxy.style.width = `${rect.width}px`;
      proxy.style.height = `${rect.height}px`;
      return;
    }
    const width = 70;
    const height = 31;
    const x = Number(event?.clientX || 0);
    const y = Number(event?.clientY || 0);
    proxy.style.left = `${x - width / 2}px`;
    proxy.style.top = `${y - height / 2}px`;
    proxy.style.width = `${width}px`;
    proxy.style.height = `${height}px`;
    input.style.direction = flippedDirection ? 'rtl' : 'ltr';
  };

  const releaseCapture = () => {
    if (pointerId == null) return;
    try { input.releasePointerCapture?.(pointerId); } catch {}
  };

  const finish = (event, cancelled = false) => {
    if (pointerId == null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    releaseCapture();
    try {
      const callback = cancelled ? handlers.onPointerCancel : handlers.onPointerUp;
      callback?.(event, { requestNativeHaptic: () => {} });
    } finally {
      pointerId = null;
      flippedDirection = false;
      input.checked = false;
      if (!disposed) positionSurface({ clientX: 0, clientY: 0 }, false);
    }
  };

  const cancelGesture = () => {
    if (pointerId == null) return;
    finish({ pointerId }, true);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    flippedDirection = false;
    positionSurface(event, false);
    try { input.setPointerCapture?.(pointerId); } catch {}
    let requestNativeHaptic = false;
    handlers.onPointerDown?.(event, {
      requestNativeHaptic: () => { requestNativeHaptic = true; },
    });
    if (requestNativeHaptic) nativeHaptic(event, false);
  };

  const onPointerMove = (event) => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    let requestNativeHaptic = false;
    handlers.onPointerMove?.(event, {
      requestNativeHaptic: () => { requestNativeHaptic = true; },
    });
    if (handlers.nativeHapticsOnMove !== false || requestNativeHaptic) nativeHaptic(event);
    else positionSurface(event, true);
  };

  proxy.addEventListener('pointerdown', onPointerDown, true);
  proxy.addEventListener('pointermove', onPointerMove, true);
  proxy.addEventListener('pointerup', finish, true);
  proxy.addEventListener('pointercancel', (event) => finish(event, true), true);
  // The native input is only a gesture sensor. Keep its real click behavior
  // intact for iOS haptics, but do not forward it to delegated app handlers.
  proxy.addEventListener('click', (event) => event.stopPropagation(), true);
  document.body?.appendChild(proxy);
  positionSurface({ clientX: 0, clientY: 0 }, false);

  // The tabbar is hidden by changing body classes while inline voice mode is
  // active. Its haptic sensor is a fixed sibling, so it must explicitly cancel
  // any captured pointer and recalculate its position when the bar returns.
  if (isTabbarGestureSurface && document.body && typeof MutationObserver === 'function') {
    const isSurfaceInactive = () => {
      if (!surface.isConnected) return true;
      const rect = surface.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return true;
      const style = window.getComputedStyle?.(surface);
      return style?.display === 'none' || style?.visibility === 'hidden' || style?.pointerEvents === 'none';
    };
    surfaceStateObserver = new MutationObserver(() => {
      if (isSurfaceInactive()) cancelGesture();
      else if (!disposed) positionSurface({ clientX: 0, clientY: 0 }, false);
    });
    surfaceStateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  const dispose = () => {
    disposed = true;
    surfaceStateObserver?.disconnect?.();
    surfaceStateObserver = null;
    releaseCapture();
    proxy.remove();
    if (surface.dataset) delete surface.dataset.pmHapticGestureSurface;
    _hapticGestureDisposers.delete(dispose);
  };
  dispose.refresh = () => {
    if (!disposed) positionSurface({ clientX: 0, clientY: 0 }, false);
  };
  _hapticGestureDisposers.add(dispose);
  return dispose;
}

// Give an arbitrary button the same real iOS haptic the model badge has: a native
// `<input switch>` overlay sits on top of the button so the user's physical tap
// toggles it (system haptic), then we forward the activation to the real control.
// The overlay is a sibling (inside a wrapper) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â not a child ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so it survives the
// button's innerHTML being rewritten (the send button morphs sendÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬ÂvoiceÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Âabort).
export function attachMobileButtonHaptic(btn, activate) {
  if (!btn || btn.dataset.pmHaptic === '1') return;
  btn.dataset.pmHaptic = '1';
  let host = btn.parentElement;
  if (!host || !host.classList.contains('pm-haptic-host')) {
    host = document.createElement('span');
    host.className = 'pm-haptic-host';
    btn.parentNode.insertBefore(host, btn);
    host.appendChild(btn);
  }
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.className = 'pm-haptic-switch-overlay';
  sw.setAttribute('aria-hidden', 'true');
  sw.tabIndex = -1;
  host.appendChild(sw);
  sw.addEventListener('click', () => {
    pmHaptic(10);
    try { typeof activate === 'function' ? activate() : btn.click(); } catch {}
  });
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Data loaders ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
async function _loadLlm(force) {
  if (_llmCache && !force) return _llmCache;
  try {
    const d = await mobileGatewayFetch('/api/settings/provider');
    _llmCache = d?.llm || { provider: 'ollama', providers: {} };
  } catch {
    _llmCache = _llmCache || { provider: 'ollama', providers: {} };
  }
  return _llmCache;
}

async function _loadCatalog(force) {
  if (_catalogCache && !force) return _catalogCache;
  try {
    const d = await mobileGatewayFetch('/api/extensions/catalog?kind=provider');
    _catalogCache = Array.isArray(d?.items) ? d.items : [];
  } catch {
    _catalogCache = Object.keys(BUILTIN_LABELS).map((id) => ({ id, name: BUILTIN_LABELS[id], runtime: {} }));
  }
  return _catalogCache;
}

async function _loadCredentialedIds(force) {
  if (_credentialedIds && !force) return _credentialedIds;
  try {
    const d = await mobileGatewayFetch('/api/settings/credentialed-model-providers');
    _credentialedIds = Array.isArray(d?.providers) ? d.providers.map(String) : [];
  } catch {
    _credentialedIds = [];
  }
  return _credentialedIds;
}

function _providerLabel(id) {
  const item = (_catalogCache || []).find((p) => p.id === id);
  return item?.name || BUILTIN_LABELS[id] || id;
}

function _modelsForProvider(provider) {
  const item = (_catalogCache || []).find((p) => p.id === provider);
  const out = [];
  const push = (arr) => { if (Array.isArray(arr)) for (const m of arr) { const s = String(m?.name || m || '').trim(); if (s && !out.includes(s)) out.push(s); } };
  // Catalog order is source of truth; builtin fills gaps only.
  push(item?.runtime?.options?.staticModels);
  push(BUILTIN_STATIC_MODELS[provider]);
  const def = item?.config?.defaults?.model;
  if (def && !out.includes(String(def))) out.unshift(String(def));
  return out;
}

function _activeModel(llm) {
  const provider = String(llm?.provider || 'ollama');
  const model = String(llm?.providers?.[provider]?.model || '');
  return { provider, model };
}

function _activeChatSessionId() {
  return String(window.__pmChat?.activeSessionId || '').trim();
}

async function _loadChatModelRoute() {
  const sessionId = _activeChatSessionId();
  if (!sessionId) return null;
  if (sessionId === 'mobile_default') return _mobileDraftModelRoute;
  try {
    const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`);
    return data?.chatModelRoute || null;
  } catch { return null; }
}

async function _saveChatModelRoute(route) {
  const sessionId = _activeChatSessionId();
  if (!sessionId) throw new Error('No active chat.');
  if (sessionId === 'mobile_default') {
    const override = {
      providerId: String(route?.providerId || '').trim(),
      model: String(route?.model || '').trim(),
      reasoningEffort: String(route?.reasoningEffort || '').trim() || undefined,
      accountId: String(route?.accountId || '').trim() || undefined,
    };
    if (!override.providerId || !override.model) throw new Error('Choose a provider and model.');
    _mobileDraftModelRoute = {
      mode: 'explicit',
      availability: 'ready',
      override,
      effective: { ...override },
    };
    window.__pmChatModelRoute = _mobileDraftModelRoute;
    return _mobileDraftModelRoute;
  }
  const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
    method: 'PUT', body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not update this chat model');
  return data?.chatModelRoute || null;
}

export function resetMobileDraftModelRoute() {
  _mobileDraftModelRoute = null;
  _llmCache = null;
  if (_activeChatSessionId() === 'mobile_default') {
    window.__pmChatModelRoute = null;
    refreshMobileModelBadge(true).catch(() => {});
  }
}

export async function applyMobileDraftModelRouteToSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const route = _mobileDraftModelRoute?.override;
  if (!sid || sid === 'mobile_default' || !route?.providerId || !route?.model) return null;
  const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sid)}/model-route`, {
    method: 'PUT',
    body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not apply the selected model to this chat');
  _mobileDraftModelRoute = null;
  window.__pmChatModelRoute = data?.chatModelRoute || null;
  return window.__pmChatModelRoute;
}

function _modelDetail(detail = {}) {
  const modelRef = String(detail?.modelRef || '').trim();
  const slashIdx = modelRef.indexOf('/');
  const provider = String(detail?.provider || detail?.providerId || (slashIdx > 0 ? modelRef.slice(0, slashIdx) : '') || '').trim();
  const model = String(detail?.model || (slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef) || '').trim();
  return { provider, model };
}

function _isSubagentModelBadge(el) {
  return !!(el?.closest?.('.pm-subagent-model-badge') || el?.classList?.contains?.('pm-subagent-model-badge'));
}

function _setBadgeLabel(label) {
  const safe = String(label || '').trim() || 'Online';
  window.__pmModelBadgeLabel = safe;
  document.querySelectorAll('.pm-model-badge .pm-model-badge-label').forEach((el) => {
    if (_isSubagentModelBadge(el)) return;
    el.textContent = safe;
  });
  return safe;
}

function _setBadgeFast(fast) {
  window.__pmModelBadgeFast = !!fast;
  document.querySelectorAll('.pm-model-badge .pm-model-speed-icon').forEach((el) => {
    if (_isSubagentModelBadge(el)) return;
    el.hidden = !fast;
  });
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Badge label refresh ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
export async function refreshMobileModelBadge(force = false, modelChangeDetail = null) {
  // Subagent chat owns its header badge (Name/Model Effort). Don't clobber it
  // with the main-chat route when that page is active.
  if (document.querySelector('.pm-subagent-model-badge') && !modelChangeDetail?.forceSubagent) {
    return window.__pmModelBadgeLabel || 'Online';
  }
  // A main_model_changed event means the global Settings model changed. A
  // mobile_default draft route is only a temporary per-chat override; keeping
  // it here would immediately overwrite the new global model with the old
  // header label and stale reasoning level.
  if (String(modelChangeDetail?.sourceEventType || '') === 'main_model_changed') {
    _mobileDraftModelRoute = null;
    window.__pmChatModelRoute = null;
    _llmCache = null;
    force = true;
  }
  const eventModel = _modelDetail(modelChangeDetail || {});
  const llm = await _loadLlm(force);
  if (eventModel.model || eventModel.provider) {
    const eventCfg = llm?.providers?.[eventModel.provider] || {};
    const eventEffort = String(modelChangeDetail?.reasoningEffort || modelChangeDetail?.reasoning_effort || eventCfg.reasoning_effort || '').trim();
    const label = _setBadgeLabel(formatModelWithReasoning(eventModel.model, eventModel.provider, eventEffort));
    // switch_model is turn-scoped and does not mutate /api/settings/provider, so
    // keep the streamed active-model label instead of overwriting it from config.
    if (String(modelChangeDetail?.sourceEventType || '') === 'model_switched') {
      _llmCache = null;
      return label;
    }
  }
  const route = await _loadChatModelRoute();
  window.__pmChatModelRoute = route;
  const { provider, model } = route?.effective?.providerId
    ? { provider: route.effective.providerId, model: route.effective.model }
    : _activeModel(llm);
  const cfg = { ...(llm?.providers?.[provider] || {}), model, reasoning_effort: route?.effective?.reasoningEffort || (llm?.providers?.[provider] || {}).reasoning_effort };
  if (route?.effective?.providerId && _llmCache) {
    _llmCache = { ..._llmCache, provider, providers: { ...(_llmCache.providers || {}), [provider]: cfg } };
  }
  _setBadgeFast(supportsFastSpeed(provider, model) && (cfg.speed === 'fast' || cfg.fast_mode === true));
  return _setBadgeLabel(formatModelWithReasoning(model, provider, cfg.reasoning_effort));
}

// Seed text used by renderMobileHeader so the badge isn't empty on first paint.
export function mobileModelBadgeSeedLabel() {
  return window.__pmModelBadgeLabel || 'Online';
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Model popover plumbing ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function _closeSheet() {
  const scrim = document.getElementById('pm-msheet-scrim');
  const sheet = document.getElementById('pm-msheet');
  const restoreFocus = sheet?.__pmModelSheetRestoreFocus;
  sheet?.__pmModelSheetCleanup?.();
  if (scrim) scrim.classList.remove('open');
  if (sheet) sheet.classList.remove('open');
  document.body.classList.remove('pm-mobile-overlay-open');
  setTimeout(() => {
    if (scrim) scrim.remove();
    if (sheet) sheet.remove();
    if (!document.getElementById('pm-msheet') && restoreFocus?.isConnected && typeof restoreFocus.focus === 'function') {
      restoreFocus.focus({ preventScroll: true });
    }
  }, 220);
}

function _positionSheetNearBadge(sheet) {
  if (!sheet) return;
  const margin = 10;
  const badge = document.querySelector('.pm-model-badge');
  const rect = badge?.getBoundingClientRect?.();
  const width = Math.min(360, Math.max(280, window.innerWidth - margin * 2));
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, center - width / 2));
  const preferredTop = rect ? rect.bottom + 10 : Math.max(70, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 70);
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - 260));
  const maxHeight = Math.max(240, window.innerHeight - top - margin);
  sheet.style.setProperty('--pm-msheet-left', `${left}px`);
  sheet.style.setProperty('--pm-msheet-top', `${top}px`);
  sheet.style.setProperty('--pm-msheet-width', `${width}px`);
  sheet.style.setProperty('--pm-msheet-max-height', `${maxHeight}px`);
}

function _openSheet(titleHtml, bodyHtml) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  _closeSheetImmediate();
  document.body.classList.add('pm-mobile-overlay-open');
  const scrim = document.createElement('div');
  scrim.id = 'pm-msheet-scrim';
  scrim.className = 'pm-msheet-scrim';
  const sheet = document.createElement('div');
  sheet.id = 'pm-msheet';
  sheet.className = 'pm-msheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="pm-msheet-handle"></div>
    <div class="pm-msheet-head">
      <div class="pm-msheet-title">${titleHtml}</div>
      <button type="button" class="pm-msheet-close" aria-label="Close">&times;</button>
    </div>
    <div class="pm-msheet-body" id="pm-msheet-body">${bodyHtml}</div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  const positionSheet = () => {
    if (sheet.classList.contains('is-reasoning') || sheet.classList.contains('is-model-switch')) return;
    _positionSheetNearBadge(sheet);
  };
  positionSheet();
  const reposition = positionSheet;
  requestAnimationFrame(() => { scrim.classList.add('open'); sheet.classList.add('open'); });
  scrim.addEventListener('click', _closeSheet);
  sheet.querySelector('.pm-msheet-close')?.addEventListener('click', _closeSheet);
  sheet.addEventListener('selectstart', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  sheet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    _closeSheet();
  };
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', reposition, { passive: true });
  window.visualViewport?.addEventListener?.('resize', reposition, { passive: true });
  sheet.__pmModelSheetCleanup = () => {
    window.removeEventListener('resize', reposition);
    window.visualViewport?.removeEventListener?.('resize', reposition);
    document.removeEventListener('keydown', onKeyDown, true);
  };
  sheet.__pmModelSheetRestoreFocus = previousFocus;
  return sheet;
}

function _closeSheetImmediate() {
  document.getElementById('pm-msheet')?.__pmModelSheetCleanup?.();
  document.getElementById('pm-msheet-scrim')?.remove();
  document.getElementById('pm-msheet')?.remove();
  document.body.classList.remove('pm-mobile-overlay-open');
}

function _setSheetBody(html) {
  const body = document.getElementById('pm-msheet-body');
  if (body) body.innerHTML = html;
  return body;
}

function _setSheetTitle(html) {
  const t = document.querySelector('#pm-msheet .pm-msheet-title');
  if (t) t.innerHTML = html;
}

function _toast(msg, kind) {
  try { window.pmToast ? window.pmToast(msg, kind) : null; } catch {}
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TAP: fluid reasoning slider + click-through advanced model controls ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
let _reasoningSaveTimer = null;
let _reasoningSaveChain = Promise.resolve();

function _effortOptions(provider, cfg = {}) {
  return reasoningSelectorOptions(provider, cfg.model || '');
}

function _effortLabel(value, provider) {
  return formatReasoningSelectorLabel(value, provider);
}

// The subagent route owns a per-agent model/reasoning route, while the main
// badge owns the current chat session route. Keeping this context explicit
// prevents a tap in subagent chat from mutating the main-chat model.
export function setMobileSubagentReasoningContext(context = null) {
  _subagentReasoningContext = context && typeof context === 'object'
    ? { ...context }
    : null;
}

async function _openReasoningSheet() {
  pmHaptic(10);
  const sheet = _openSheet('', '<div class="pm-msheet-loading">LoadingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</div>');
  sheet?.classList.add('is-reasoning');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-reasoning');
  sheet?.removeAttribute('style');
  await Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true)]);
  await refreshMobileModelBadge(true);
  const { provider } = _activeModel(_llmCache);
  const cfg = (_llmCache.providers || {})[provider] || {};
  _renderReasoningBody(provider, cfg, { onAdvanced: _openSwitchSheet });
}

function _renderReasoningBody(provider, cfg, { onAdvanced = _openSwitchSheet, onSave = null } = {}) {
  const options = _effortOptions(provider, cfg);
  const current = String(cfg.reasoning_effort || '').trim();
  const selectedIndex = Math.max(0, options ? options.indexOf(current) : 0);
  const selectedProgress = options && options.length > 1 ? selectedIndex / (options.length - 1) : 0;
  _setSheetTitle('');
  const body = _setSheetBody(renderReasoningSelector({
    provider,
    model: cfg.model,
    effort: current,
    selectorId: 'pm-reasoning-selector',
    controlId: 'pm-reasoning-control',
    liveLabelId: 'pm-reasoning-live-label',
    advancedId: 'pm-reasoning-advanced',
    includeAdvanced: typeof onAdvanced === 'function',
  }));
  if (!body) return;

  document.getElementById('pm-reasoning-advanced')?.addEventListener('click', () => {
    pmHaptic(10);
    onAdvanced?.();
  });

  const control = document.getElementById('pm-reasoning-control');
  if (control && options) {
    control.setAttribute('aria-label', 'Reasoning level. Swipe left or right to adjust.');
    control.setAttribute('aria-orientation', 'horizontal');
    let lastIndex = selectedIndex;
    let requestGestureNativeHaptic = null;
    const indexMax = Math.max(1, options.length - 1);
    const setProgress = (progress) => {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      control.style.setProperty('--pm-reasoning-progress', String(safeProgress));
      const fillWidth = ((1 / options.length) + safeProgress * ((options.length - 1) / options.length)) * 100;
      control.style.setProperty('--pm-reasoning-fill-width', `${fillWidth}%`);
    };
    const commitIndex = (index, immediate = false, { snap = true, save = true } = {}) => {
      const safeIndex = Math.max(0, Math.min(options.length - 1, Number(index) || 0));
      const value = options[safeIndex] || '';
      const label = _effortLabel(value, provider);
      control.style.setProperty('--pm-reasoning-index', String(safeIndex));
      if (snap) setProgress(safeIndex / indexMax);
      control.setAttribute('aria-valuenow', String(safeIndex));
      control.setAttribute('aria-valuetext', label);
      document.getElementById('pm-reasoning-live-label').textContent = label;
      control.querySelectorAll('.pm-reasoning-segment').forEach((segment, segmentIndex) => {
        segment.classList.toggle('is-active', segmentIndex === safeIndex);
        segment.classList.toggle('is-filled', segmentIndex <= safeIndex);
      });
      if (safeIndex !== lastIndex) {
        const step = safeIndex > lastIndex ? 1 : -1;
        for (let tick = lastIndex + step; tick !== safeIndex + step; tick += step) {
          requestGestureNativeHaptic?.();
          pmHaptic(8);
        }
        lastIndex = safeIndex;
      }
      if (save) {
        const saveResult = onSave
          ? onSave(value, { immediate })
          : _queueReasoningSave(provider, { reasoning_effort: value }, immediate);
        if (saveResult?.catch) saveResult.catch((err) => _toast(err?.message || 'Could not save reasoning', 'error'));
      }
    };
    const progressFromEvent = (event) => {
      const rect = control.getBoundingClientRect();
      if (!rect.width) return 0;
      return (Number(event.clientX || 0) - rect.left) / rect.width;
    };
    const indexFromProgress = (progress) => {
      return Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * (options.length - 1));
    };
    const updateFromPointer = (event, immediate = false) => {
      const progress = progressFromEvent(event);
      setProgress(progress);
      commitIndex(indexFromProgress(progress), immediate, { snap: immediate, save: immediate });
    };
    control.querySelectorAll('.pm-reasoning-segment').forEach((segment) => {
      segment.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitIndex(segment.getAttribute('data-index'), true);
      });
    });
    const pointerHandlers = {
      onPointerDown: (event, gesture) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        requestGestureNativeHaptic = gesture?.requestNativeHaptic || null;
        control.classList.add('is-dragging');
        updateFromPointer(event);
      },
      onPointerMove: (event, gesture) => {
        if (!control.classList.contains('is-dragging')) return;
        requestGestureNativeHaptic = gesture?.requestNativeHaptic || requestGestureNativeHaptic;
        updateFromPointer(event);
      },
      onPointerUp: (event, gesture) => {
        if (!control.classList.contains('is-dragging')) return;
        requestGestureNativeHaptic = gesture?.requestNativeHaptic || requestGestureNativeHaptic;
        try {
          control.classList.remove('is-dragging');
          updateFromPointer(event, true);
        } finally {
          requestGestureNativeHaptic = null;
        }
      },
      onPointerCancel: (event, gesture) => {
        if (!control.classList.contains('is-dragging')) return;
        requestGestureNativeHaptic = gesture?.requestNativeHaptic || requestGestureNativeHaptic;
        try {
          control.classList.remove('is-dragging');
          updateFromPointer(event, true);
        } finally {
          requestGestureNativeHaptic = null;
        }
      },
      nativeHapticsOnMove: false,
    };
    attachMobileHapticGestureSurface(control, pointerHandlers);
    control.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = Number(control.getAttribute('aria-valuenow') || selectedIndex);
      if (event.key === 'Home') commitIndex(0, true);
      else if (event.key === 'End') commitIndex(options.length - 1, true);
      else commitIndex(currentIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
    });
  }
}

async function _openSubagentReasoningSheet() {
  const context = _subagentReasoningContext;
  if (!context?.agentId) return;
  pmHaptic(10);
  const sheet = _openSheet('', '<div class="pm-msheet-loading">LoadingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</div>');
  sheet?.classList.add('is-reasoning');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-reasoning');
  sheet?.removeAttribute('style');
  const provider = String(context.provider || '').trim();
  const model = String(context.model || '').trim();
  _renderReasoningBody(provider, {
    model,
    reasoning_effort: String(context.effort || '').trim(),
  }, {
    onAdvanced: null,
    onSave: (() => {
      let saveChain = Promise.resolve();
      return (value) => {
        const effort = String(value || '');
        saveChain = saveChain.catch(() => {}).then(async () => {
          const result = await mobileGatewayFetch(`/api/agents/${encodeURIComponent(context.agentId)}/model`, {
            method: 'PATCH',
            body: JSON.stringify({ reasoning_effort: effort }),
          });
          if (result?.success === false) throw new Error(result.error || 'Could not save reasoning');
          context.effort = effort;
          _subagentReasoningContext = { ...context };
          context.onSaved?.({ effort: context.effort, agent: result?.agent || null });
        });
        return saveChain;
      };
    })(),
  });
}

function _queueReasoningSave(provider, patch, immediate = false) {
  const existing = (_llmCache?.providers || {})[provider] || {};
  const merged = { ...existing, ...patch };
  if (merged.reasoning_effort === '') delete merged.reasoning_effort;
  if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
  _setBadgeLabel(formatModelWithReasoning(merged.model || _activeModel(_llmCache).model, provider, merged.reasoning_effort));
  clearTimeout(_reasoningSaveTimer);
  const commit = () => {
    _reasoningSaveChain = _reasoningSaveChain.then(async () => {
      const route = await _loadChatModelRoute();
      const effective = route?.effective || { providerId: provider, model: merged.model || _activeModel(_llmCache).model };
      await _saveChatModelRoute({ providerId: provider, model: merged.model || effective.model, reasoningEffort: merged.reasoning_effort || undefined, accountId: effective.accountId || undefined });
      await refreshMobileModelBadge(true);
    }).catch((err) => _toast(err?.message || 'Could not save reasoning', 'error'));
  };
  if (immediate) commit();
  else _reasoningSaveTimer = setTimeout(commit, 180);
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Advanced: provider / model / intelligence controls ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
async function _openSwitchSheet() {
  const sheet = _openSheet('Advanced <span class="pm-msheet-chev">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº</span>', '<div class="pm-msheet-loading">Loading controlsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</div>');
  sheet?.classList.add('is-model-switch');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-model-switch');
  sheet?.removeAttribute('style');
  await Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true)]);
  await refreshMobileModelBadge(true);
  _renderAdvancedSheet();
}

function _currentAdvancedState() {
  const { provider, model } = _activeModel(_llmCache);
  const cfg = (_llmCache?.providers || {})[provider] || {};
  const options = _effortOptions(provider, cfg);
  const effort = String(cfg.reasoning_effort || '').trim();
  const effortValue = options && options.includes(effort) ? effort : (options ? options[0] : '');
  return { provider, model: cfg.model || model, cfg, options, effortValue };
}

function _advancedRow(label, value, action, { disabled = false } = {}) {
  return `
    <button type="button" class="pm-advanced-row" data-action="${_esc(action)}" ${disabled ? 'disabled' : ''}>
      <span class="pm-advanced-row-label">${_esc(label)}</span>
      <span class="pm-advanced-row-value">${_esc(value)}</span>
      <span class="pm-advanced-row-chev" aria-hidden="true">ÃƒÂ¢Ã…â€™Ã¢â‚¬Å¾</span>
    </button>`;
}

function _renderAdvancedSheet() {
  _setSheetTitle('Advanced <span class="pm-msheet-chev">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº</span>');
  const { provider, model, cfg, options, effortValue } = _currentAdvancedState();
  const rows = [
    _advancedRow('Provider', _providerLabel(provider), 'provider'),
    _advancedRow('Model', prettifyModelName(model, provider), 'model'),
    _advancedRow('Intelligence', options ? _effortLabel(effortValue, provider) : 'Default', 'intelligence', { disabled: !options }),
  ];
  if (supportsFastSpeed(provider, model)) rows.push(_advancedRow('Speed', cfg.speed === 'fast' || cfg.fast_mode === true ? 'Fast' : 'Standard', 'speed'));
  const body = _setSheetBody(`<div class="pm-advanced-panel">${rows.join('')}</div>`);
  if (!body) return;
  body.querySelector('[data-action="provider"]')?.addEventListener('click', _renderProviderList);
  body.querySelector('[data-action="model"]')?.addEventListener('click', () => _renderModelList(provider));
  body.querySelector('[data-action="intelligence"]')?.addEventListener('click', () => _renderEffortList(provider));
  body.querySelector('[data-action="speed"]')?.addEventListener('click', () => _renderSpeedList(provider));
}

function _renderSpeedList(provider) {
  const cfg = (_llmCache?.providers || {})[provider] || {};
  if (!supportsFastSpeed(provider, cfg.model || '')) return _renderAdvancedSheet();
  const current = cfg.speed === 'fast' || cfg.fast_mode === true ? 'fast' : 'standard';
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹</button> Speed`);
  const rows = ['standard', 'fast'].map(value => `<button type="button" class="pm-msheet-row" data-speed="${value}"><span class="pm-msheet-row-label">${value === 'fast' ? 'Fast' : 'Standard'}</span>${value === current ? '<span class="pm-msheet-check">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span>' : ''}</button>`).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  body?.querySelectorAll('[data-speed]').forEach(btn => btn.addEventListener('click', () => {
    const speed = btn.getAttribute('data-speed') === 'fast' ? 'fast' : 'standard';
    _queueReasoningSave(provider, { speed }, true);
    const merged = { ...cfg, speed }; delete merged.fast_mode;
    if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
    _setBadgeFast(speed === 'fast');
    _renderAdvancedSheet();
  }));
}

function _renderProviderList() {
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹</button> Provider`);
  const { provider: activeProvider } = _activeModel(_llmCache);
  const ids = (_credentialedIds || []).slice();
  if (activeProvider && !ids.includes(activeProvider)) ids.unshift(activeProvider);
  // Keep a stable, builtin-first ordering.
  const order = Object.keys(BUILTIN_LABELS);
  ids.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (!ids.length) {
    _setSheetBody('<div class="pm-msheet-empty">No providers with saved credentials. Add an API key or connect a provider in Settings.</div>');
    document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
    return;
  }

  const rows = ids.map((id) => `
    <button type="button" class="pm-msheet-row" data-provider="${_esc(id)}">
      <span class="pm-msheet-row-label">${_esc(_providerLabel(id))}</span>
      ${id === activeProvider ? '<span class="pm-msheet-dot" title="Current"></span>' : ''}
      <span class="pm-msheet-chev">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº</span>
    </button>`).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextProvider = btn.getAttribute('data-provider');
      const existing = (_llmCache?.providers || {})[nextProvider] || {};
      const nextModel = existing.model || _modelsForProvider(nextProvider)[0] || '';
      if (nextModel) await _switchModel(nextProvider, nextModel, { keepOpen: true, returnToAdvanced: true });
      else _renderModelList(nextProvider);
    });
  });
}

function _renderModelList(provider) {
  const { provider: activeProvider, model: activeModel } = _activeModel(_llmCache);
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹</button> Model`);
  const models = _modelsForProvider(provider);

  let rows = models.map((m) => {
    const isActive = provider === activeProvider && m === activeModel;
    return `<button type="button" class="pm-msheet-row" data-model="${_esc(m)}">
      <span class="pm-msheet-row-label">${_esc(prettifyModelName(m, provider))}</span>
      ${isActive ? '<span class="pm-msheet-check">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span>' : ''}
    </button>`;
  }).join('');
  if (!models.length) {
    rows = '<div class="pm-msheet-empty">No known models. Fetch them from Settings > Models.</div>';
  }
  const body = _setSheetBody(`<div class="pm-msheet-rows pm-msheet-model-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-model]').forEach((btn) => {
    btn.addEventListener('click', () => _switchModel(provider, btn.getAttribute('data-model'), { keepOpen: true, returnToAdvanced: true }));
  });
}

function _renderEffortList(provider) {
  const cfg = (_llmCache?.providers || {})[provider] || {};
  const options = _effortOptions(provider, cfg);
  if (!options) {
    _renderAdvancedSheet();
    return;
  }
  const current = String(cfg.reasoning_effort || '').trim();
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹</button> Intelligence`);
  const rows = options.map((value) => {
    const isActive = value === current || (!value && !current);
    return `<button type="button" class="pm-msheet-row" data-effort="${_esc(value)}">
      <span class="pm-msheet-row-label">${_esc(_effortLabel(value, provider))}</span>
      ${isActive ? '<span class="pm-msheet-check">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span>' : ''}
    </button>`;
  }).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-effort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-effort') || '';
      _queueReasoningSave(provider, { reasoning_effort: value }, true);
      const merged = { ...cfg, reasoning_effort: value };
      if (!value) delete merged.reasoning_effort;
      if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
      _renderAdvancedSheet();
    });
  });
}

async function _switchModel(provider, model, { keepOpen = false, returnToAdvanced = false } = {}) {
  if (!provider || !model) return;
  try {
    const current = await _loadChatModelRoute();
    await _saveChatModelRoute({ providerId: provider, model, reasoningEffort: current?.effective?.providerId === provider ? current.effective.reasoningEffort || undefined : undefined, accountId: current?.effective?.providerId === provider ? current.effective.accountId || undefined : undefined });
    window.__pmChatModelRoute = await _loadChatModelRoute();
    const nextCfg = { ...((_llmCache?.providers || {})[provider] || {}), model, reasoning_effort: window.__pmChatModelRoute?.effective?.reasoningEffort };
    _toast(`Model ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ${prettifyModelName(model, provider)}`, 'success');
    await refreshMobileModelBadge(false, { provider, model });
    try { window.dispatchEvent(new CustomEvent('pm-model-changed', { detail: { provider, model } })); } catch {}
    if (keepOpen && returnToAdvanced) _renderAdvancedSheet();
    else if (keepOpen) _renderReasoningBody(provider, nextCfg, true);
    else _closeSheet();
  } catch (err) {
    _toast(err?.message || 'Could not switch model', 'error');
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Tap gesture wiring (delegated, attached once) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
let _wired = false;

export function initMobileModelBadge() {
  if (_wired) return;
  _wired = true;

  const findBadge = (target) => (target?.closest ? target.closest('.pm-model-badge') : null);

  document.addEventListener('contextmenu', (event) => {
    if (!findBadge(event.target)) return;
    event.preventDefault();
  }, true);

  document.addEventListener('click', (event) => {
    const badge = findBadge(event.target);
    if (!badge) return;
    event.preventDefault();
    event.stopPropagation();
    if (_isSubagentModelBadge(badge)) {
      _openSubagentReasoningSheet();
      return;
    }
    _openReasoningSheet();
  });

  // Keep the label fresh on navigation and when the model changes elsewhere.
  window.addEventListener('hashchange', () => { refreshMobileModelBadge(false).catch(() => {}); });
  window.addEventListener('pm-model-changed', (event) => {
    const detail = event?.detail || {};
    refreshMobileModelBadge(true, detail).catch(() => {});
  });

  refreshMobileModelBadge(true).catch(() => {});
}
