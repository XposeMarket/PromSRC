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
  hasReasoningCapabilityPolicy,
  isChatGPTWebModel,
  supportsFastSpeed,
  validEffort,
} from '../reasoning-capabilities.js';
import { formatModelDisplayName, formatModelWithReasoning, formatReasoningDisplayName } from '../model-display.js';
import { renderReasoningSelector, reasoningSliderFillWidth, reasoningProgressFromPointer } from '../components/reasoning-selector.js';
import { reasoningSheetViewportPlacement } from './mobile-reasoning-sheet-geometry.js';
import { attachNativePicker } from './mobile-native-picker.js';

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
  openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['chatgpt', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-5-5', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.3-latest', 'grok-latest', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent', 'grok-build-0.1'],
};

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Caches ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
let _llmCache = null;            // full llm config { provider, providers }
let _catalogCache = null;        // [{ id, name, runtime, ... }]
let _credentialedIds = null;     // [providerId, ...]
let _mobileDraftModelRoute = null; // Unsaved new-chat override; never writes Settings.
let _subagentReasoningContext = null;
const MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY = 'pm_mobile_chat_model_route_v1';

function _normalizeSavedChatModelRoute(route) {
  const candidate = route?.override && typeof route.override === 'object' ? route.override : route;
  const providerId = String(candidate?.providerId || candidate?.provider || '').trim();
  const model = String(candidate?.model || '').trim();
  if (!providerId || !model) return null;
  const override = {
    providerId,
    model,
    reasoningEffort: String(candidate?.reasoningEffort || candidate?.reasoning_effort || '').trim() || undefined,
    speed: String(candidate?.speed || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard',
    accountId: String(candidate?.accountId || candidate?.account_id || '').trim() || undefined,
  };
  return {
    mode: 'explicit',
    availability: 'ready',
    override,
    effective: { ...override },
  };
}

function _readSavedChatModelRoute() {
  try {
    return _normalizeSavedChatModelRoute(JSON.parse(localStorage.getItem(MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

function _writeSavedChatModelRoute(route) {
  const normalized = _normalizeSavedChatModelRoute(route);
  if (!normalized) return;
  try {
    localStorage.setItem(MOBILE_CHAT_MODEL_ROUTE_STORAGE_KEY, JSON.stringify(normalized.override));
  } catch {}
}

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
    // A single trusted/synchronous click is the only native-switch attempt.
    // Flipping `checked` again immediately cancels the state transition and
    // made fallback ticks look like two changes to DOM observers.
    sw.click?.();
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
    let requestedNativeTicks = 0;
    handlers.onPointerDown?.(event, {
      requestNativeHaptic: () => { requestedNativeTicks += 1; },
    });
    for (let tick = 0; tick < requestedNativeTicks; tick += 1) nativeHaptic(event, false);
  };

  const onPointerMove = (event) => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    let requestedNativeTicks = 0;
    handlers.onPointerMove?.(event, {
      requestNativeHaptic: () => { requestedNativeTicks += 1; },
    });
    // Continuous surfaces retain their legacy one-tick-per-move behavior.
    // Step controls opt out and request exactly one shared native-switch tick
    // for each crossed value boundary.
    const nativeTicks = requestedNativeTicks || (handlers.nativeHapticsOnMove !== false ? 1 : 0);
    if (nativeTicks) {
      for (let tick = 0; tick < nativeTicks; tick += 1) nativeHaptic(event);
    } else positionSurface(event, true);
  };

  proxy.addEventListener('pointerdown', onPointerDown, true);
  proxy.addEventListener('pointermove', onPointerMove, true);
  proxy.addEventListener('pointerup', finish, true);
  proxy.addEventListener('pointercancel', (event) => finish(event, true), true);
  // Pointer capture is not guaranteed to survive an iOS viewport gesture,
  // app backgrounding, or browser-chrome transition. Treat every lifecycle
  // escape hatch as cancellation so visual pressed state cannot remain stuck.
  const onLostPointerCapture = () => queueMicrotask(cancelGesture);
  const onWindowBlur = () => cancelGesture();
  const onPageHide = () => cancelGesture();
  const onVisibilityChange = () => {
    if (document.hidden) cancelGesture();
  };
  input.addEventListener('lostpointercapture', onLostPointerCapture, true);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // The native input is only a gesture sensor. Keep its real click behavior
  // intact for iOS haptics, but do not forward it to delegated app handlers.
  proxy.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onClick?.(event);
  }, true);
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
  const onViewportResize = () => {
    if (!disposed && pointerId == null) positionSurface({ clientX: 0, clientY: 0 }, false);
  };
  window.addEventListener('resize', onViewportResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportResize, { passive: true });
  window.visualViewport?.addEventListener('scroll', onViewportResize, { passive: true });

  const dispose = () => {
    cancelGesture();
    disposed = true;
    surfaceStateObserver?.disconnect?.();
    surfaceStateObserver = null;
    releaseCapture();
    input.removeEventListener('lostpointercapture', onLostPointerCapture, true);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onViewportResize);
    window.visualViewport?.removeEventListener('resize', onViewportResize);
    window.visualViewport?.removeEventListener('scroll', onViewportResize);
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

// Per-provider plan usage for the provider list ("Primary Account: XX% Left").
// Same source as Settings and the context-window card (/api/usage/limits).
let _usageCache = null;
let _usageFetchedAt = 0;
const USAGE_CACHE_TTL_MS = 60_000;

async function _loadUsage(force) {
  if (_usageCache && !force && Date.now() - _usageFetchedAt < USAGE_CACHE_TTL_MS) return _usageCache;
  try {
    const d = await mobileGatewayFetch('/api/usage/limits');
    if (d && d.success !== false) {
      _usageCache = Array.isArray(d.providers) ? d.providers : [];
      _usageFetchedAt = Date.now();
    }
  } catch {}
  return _usageCache || [];
}

function _usageIsFresh() {
  return !!_usageCache && Date.now() - _usageFetchedAt < USAGE_CACHE_TTL_MS;
}

// Percent left on the provider's primary account, using its most-constrained
// window (e.g. Anthropic 5-hour 31% / weekly 56% used -> 44% left).
function _primaryUsageLeft(providerId) {
  const rows = (_usageCache || []).filter((row) => String(row?.provider || '') === providerId
    && Array.isArray(row?.windows) && row.windows.length);
  if (!rows.length) return null;
  const cfg = (_llmCache?.providers || {})[providerId] || {};
  const primaryId = String(cfg.defaultAccountId || cfg.accountId || '').trim();
  const row = (primaryId && rows.find((r) => String(r?.account_id || '') === primaryId))
    || rows.find((r) => String(r?.account_id || '') === 'default')
    || rows[0];
  const used = row.windows.map((w) => Number(w?.used_percent)).filter((n) => Number.isFinite(n));
  if (!used.length) return null;
  return Math.max(0, Math.min(100, Math.round(100 - Math.max(...used))));
}

function _providerLabel(id) {
  const item = (_catalogCache || []).find((p) => p.id === id);
  return item?.name || BUILTIN_LABELS[id] || id;
}

function _modelsForProvider(provider) {
  const item = (_catalogCache || []).find((p) => p.id === provider);
  const out = [];
  const push = (arr) => { if (Array.isArray(arr)) for (const m of arr) { const s = String(m?.name || m || '').trim(); if (s && !out.includes(s)) out.push(s); } };
  // Catalog order is source of truth; builtin fills gaps only. A gap is
  // inserted right after its builtin predecessor instead of appended, so a
  // catalog cached before a new model shipped (e.g. across a restart) does not
  // push that model to the bottom of the picker.
  push(item?.runtime?.options?.staticModels);
  const builtin = Array.isArray(BUILTIN_STATIC_MODELS[provider]) ? BUILTIN_STATIC_MODELS[provider] : [];
  builtin.forEach((raw, idx) => {
    const s = String(raw || '').trim();
    if (!s || out.includes(s)) return;
    let at = -1;
    for (let j = idx - 1; j >= 0 && at < 0; j--) at = out.indexOf(String(builtin[j] || '').trim());
    if (at >= 0) out.splice(at + 1, 0, s);
    else {
      let next = -1;
      for (let j = idx + 1; j < builtin.length && next < 0; j++) next = out.indexOf(String(builtin[j] || '').trim());
      if (next >= 0) out.splice(next, 0, s); else out.push(s);
    }
  });
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
  if (sessionId === 'mobile_default') {
    if (!_mobileDraftModelRoute) _mobileDraftModelRoute = _readSavedChatModelRoute();
    return _mobileDraftModelRoute;
  }
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
      speed: String(route?.speed || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard',
      accountId: String(route?.accountId || '').trim() || undefined,
    };
    if (!override.providerId || !override.model) throw new Error('Choose a provider and model.');
    _mobileDraftModelRoute = {
      mode: 'explicit',
      availability: 'ready',
      override,
      effective: { ...override },
    };
    _writeSavedChatModelRoute(_mobileDraftModelRoute);
    window.__pmChatModelRoute = _mobileDraftModelRoute;
    return _mobileDraftModelRoute;
  }
  const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
    method: 'PUT', body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not update this chat model');
  _writeSavedChatModelRoute(data?.chatModelRoute || route);
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
  const route = (_mobileDraftModelRoute || _readSavedChatModelRoute())?.override;
  if (!sid || sid === 'mobile_default' || !route?.providerId || !route?.model) return null;
  const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sid)}/model-route`, {
    method: 'PUT',
    body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not apply the selected model to this chat');
  _writeSavedChatModelRoute(data?.chatModelRoute || route);
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
    const badge = el.closest('.pm-composer-model-badge');
    if (badge) {
      const model = String(window.__pmModelBadgeModelLabel || safe).trim();
      const effort = String(window.__pmModelBadgeReasoningLabel || '').trim();
      const modelNode = document.createElement('strong');
      modelNode.className = 'pm-composer-model-name';
      modelNode.textContent = model;
      const nodes = [modelNode];
      if (effort) {
        const effortNode = document.createElement('span');
        effortNode.className = 'pm-composer-reasoning-name';
        effortNode.textContent = effort;
        nodes.push(effortNode);
      }
      el.replaceChildren(...nodes);
    } else el.textContent = safe;
  });
  return safe;
}

function _setComposerModelIdentity(provider, model, effort) {
  window.__pmModelBadgeModelLabel = formatModelDisplayName(model, provider);
  // ChatGPT has modes (Instant … Pro), not effort levels; the generic
  // formatter would show "Ultra" for Pro.
  window.__pmModelBadgeReasoningLabel = String(provider || '').toLowerCase() === 'openai_codex' && isChatGPTWebModel(model)
    ? (effort ? formatReasoningSelectorLabel(effort, provider, model) : '')
    : formatReasoningDisplayName(effort);
  const key = String(provider || '').toLowerCase();
  const name = String(model || '').toLowerCase();
  const asset = key === 'anthropic' || name.includes('claude') ? 'claude'
    : key === 'openai_codex' || name.includes('codex') ? 'openai'
    : key === 'openai' || name.startsWith('gpt-') ? 'chatgpt'
    : key === 'xai' || name.includes('grok') ? 'xai' : '';
  document.querySelectorAll('.pm-composer-model-logo').forEach((logo) => {
    logo.hidden = !asset;
    if (asset) logo.src = `/static/assets/import-sources/${asset}.svg`;
    logo.dataset.pmBrand = asset;
  });
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
    const eventEffort = _normalizedReasoningEffort(
      eventModel.provider,
      eventModel.model,
      modelChangeDetail?.reasoningEffort || modelChangeDetail?.reasoning_effort || eventCfg.reasoning_effort,
    );
    _setComposerModelIdentity(eventModel.provider, eventModel.model, eventEffort);
    const label = _setBadgeLabel(formatModelWithReasoning(eventModel.model, eventModel.provider, eventEffort));
    // switch_model is turn-scoped and does not mutate /api/settings/provider, so
    // keep the streamed active-model label instead of overwriting it from config.
    if (String(modelChangeDetail?.sourceEventType || '') === 'model_switched' && modelChangeDetail?.fromSelector !== true) {
      _llmCache = null;
      return label;
    }
  }
  const route = await _loadChatModelRoute();
  window.__pmChatModelRoute = route;
  const { provider, model } = route?.effective?.providerId
    ? { provider: route.effective.providerId, model: route.effective.model }
    : _activeModel(llm);
  const hasEffectiveRoute = Boolean(route?.effective?.providerId);
  const rawReasoningEffort = hasEffectiveRoute
    ? route.effective.reasoningEffort
    : (llm?.providers?.[provider] || {}).reasoning_effort;
  const cfg = {
    ...(llm?.providers?.[provider] || {}),
    model,
    reasoning_effort: _normalizedReasoningEffort(provider, model, rawReasoningEffort),
    speed: route?.effective?.speed || (llm?.providers?.[provider] || {}).speed || 'standard',
  };
  if (route?.effective?.providerId && _llmCache) {
    _llmCache = { ..._llmCache, provider, providers: { ...(_llmCache.providers || {}), [provider]: cfg } };
  }
  _setBadgeFast(supportsFastSpeed(provider, model) && (cfg.speed === 'fast' || cfg.fast_mode === true));
  _setComposerModelIdentity(provider, model, cfg.reasoning_effort);
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
  if (restoreFocus?.id === 'pm-composer-input' && restoreFocus.isConnected && document.activeElement !== restoreFocus) {
    try { restoreFocus.focus({ preventScroll: true }); } catch { restoreFocus.focus(); }
  }
  window.dispatchEvent(new Event('pm-mobile-model-sheet-closed'));
  setTimeout(() => {
    if (scrim) scrim.remove();
    if (sheet) sheet.remove();
    if (!document.getElementById('pm-msheet') && restoreFocus?.isConnected && document.activeElement !== restoreFocus && typeof restoreFocus.focus === 'function') {
      restoreFocus.focus({ preventScroll: true });
    }
  }, 220);
}

function _visibleComposerModelBadge() {
  const viewport = window.visualViewport;
  const viewportTop = Math.max(0, Number(viewport?.offsetTop) || 0);
  const viewportBottom = viewportTop + Math.max(0, Number(viewport?.height) || Number(window.innerHeight) || 0);
  return Array.from(document.querySelectorAll('.pm-composer-model-badge')).find((badge) => {
    const rect = badge.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom;
  }) || null;
}

function _positionSheetNearBadge(sheet) {
  if (!sheet) return;
  const margin = 10;
  const badge = document.querySelector('.pm-model-badge');
  const rect = badge?.getBoundingClientRect?.();
  const viewport = window.visualViewport;
  const viewportLeft = Math.max(0, Number(viewport?.offsetLeft) || 0);
  const viewportWidth = Math.max(0, Number(viewport?.width) || Number(window.innerWidth) || 0);
  const width = Math.min(360, Math.max(280, viewportWidth - margin * 2));
  const center = rect ? rect.left + rect.width / 2 : viewportLeft + viewportWidth / 2;
  const left = Math.max(viewportLeft + margin, Math.min(viewportLeft + viewportWidth - width - margin, center - width / 2));
  const preferredTop = rect ? rect.bottom + 10 : Math.max(70, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 70);
  const visualBottom = Math.max(0, Number(viewport?.offsetTop) || 0) + Math.max(0, Number(viewport?.height) || Number(window.innerHeight) || 0);
  const top = Math.max(margin, Math.min(preferredTop, visualBottom - 260));
  const maxHeight = Math.max(240, visualBottom - top - margin);
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
  if (previousFocus?.id === 'pm-composer-input') sheet.classList.add('has-composer-keyboard');
  const positionSheet = () => {
    if (sheet.classList.contains('is-model-switch')) {
      // The Advanced (provider/model/intelligence) sheet is a full-width
      // bottom sheet. Only the compact reasoning slider floats above the
      // composer; anchoring this one too left it hovering mid-screen with its
      // rows clipped by the slider's 280px height.
      const app = document.querySelector('.pm-app');
      const offset = sheet.classList.contains('has-composer-keyboard') && app?.classList.contains('pm-keyboard-open')
        ? Math.max(0, Number.parseFloat(app.style.getPropertyValue('--pm-keyboard-offset')) || 0)
        : 0;
      sheet.style.setProperty('bottom', `${offset}px`, 'important');
      sheet.style.removeProperty('height');
      sheet.style.removeProperty('max-height');
      sheet.classList.remove('pm-msheet-short-viewport');
      return;
    }
    if (sheet.classList.contains('is-reasoning')) {
      // Anchor the reasoning sheet to the visual viewport, not the layout
      // viewport. The old keyboard-offset-only path put the sheet under the
      // composer trigger during short keyboard viewports and Safari panning.
      // Never anchor to the hidden header badge: its top-edge rect produces a
      // near-zero space above it. The visible composer badge is the trigger
      // while typing; without it, use the full visual viewport below header UI.
      const trigger = _visibleComposerModelBadge();
      const placement = reasoningSheetViewportPlacement({
        visualViewport: window.visualViewport,
        layoutHeight: Math.max(Number(window.innerHeight) || 0, Number(document.documentElement?.clientHeight) || 0),
        triggerRect: trigger?.getBoundingClientRect?.(),
        preferredHeight: 176,
      });
      const sheetHeight = Math.floor(placement.height);
      // Pin top in layout coordinates; Safari's fixed bottom reference can
      // differ from innerHeight while its visual viewport is keyboard-panned.
      sheet.style.setProperty('top', `${Math.round(placement.top)}px`, 'important');
      sheet.style.setProperty('bottom', 'auto', 'important');
      sheet.style.setProperty('height', `${sheetHeight}px`, 'important');
      sheet.style.setProperty('max-height', `${Math.max(0, Math.floor(placement.maxHeight))}px`, 'important');
      sheet.classList.toggle('pm-msheet-short-viewport', placement.isShortViewport);
      return;
    }
    _positionSheetNearBadge(sheet);
  };
  positionSheet();
  let positionRaf = 0;
  const reposition = () => {
    if (positionRaf) return;
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      if (sheet.isConnected) positionSheet();
    });
  };
  requestAnimationFrame(() => { scrim.classList.add('open'); sheet.classList.add('open'); positionSheet(); });
  scrim.addEventListener('click', _closeSheet);
  scrim.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
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
  const composerObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
  const composer = document.getElementById('pm-composer');
  if (composer) composerObserver?.observe(composer);
  document.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition, { passive: true });
  window.visualViewport?.addEventListener?.('resize', reposition, { passive: true });
  window.visualViewport?.addEventListener?.('scroll', reposition, { passive: true });
  sheet.__pmModelSheetCleanup = () => {
    if (positionRaf) cancelAnimationFrame(positionRaf);
    sheet.__pmReasoningGestureDispose?.();
    composerObserver?.disconnect();
    document.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    window.visualViewport?.removeEventListener?.('resize', reposition);
    window.visualViewport?.removeEventListener?.('scroll', reposition);
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

function _normalizedReasoningEffort(provider, model, value) {
  const rawEffort = String(value || '').trim().toLowerCase().replace(/^extra[-_ ]high$/, 'xhigh');
  const effort = rawEffort === 'none' || rawEffort === 'minimal' ? 'low' : rawEffort;
  if (!effort || effort === 'default' || effort === 'provider_default') return effort;
  if (!hasReasoningCapabilityPolicy(provider)) return effort;
  return validEffort(provider, model, effort) ? effort : '';
}

function _effortLabel(value, provider, model = '') {
  return formatReasoningSelectorLabel(value, provider, model);
}

// The subagent route owns a per-agent model/reasoning route, while the main
// badge owns the current chat session route. Keeping this context explicit
// prevents a tap in subagent chat from mutating the main-chat model.
export function setMobileSubagentReasoningContext(context = null) {
  _subagentReasoningContext = context && typeof context === 'object'
    ? { ...context }
    : null;
}

function _pickerStateKey() {
  const { provider } = _activeModel(_llmCache);
  const cfg = (_llmCache?.providers || {})[provider] || {};
  return `${provider}|${cfg.model || ''}|${cfg.reasoning_effort || ''}|${cfg.speed || ''}`;
}

// Refresh picker data in the background. The badge refresh reuses the llm
// config fetched here instead of fetching it a second time.
function _refreshPickerData() {
  return Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true), _loadUsage(false)])
    .then(() => refreshMobileModelBadge(false))
    .catch(() => {});
}

async function _openReasoningSheet() {
  pmHaptic(10);
  // Open instantly from cached data when we have it, then revalidate. Only the
  // very first open (nothing cached yet) shows a loading state.
  const warm = !!(_llmCache && _catalogCache);
  const sheet = _openSheet('', warm ? '' : '<div class="pm-msheet-loading">Loading...</div>');
  sheet?.classList.add('is-reasoning');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-reasoning');
  const render = () => {
    const { provider } = _activeModel(_llmCache);
    const cfg = (_llmCache?.providers || {})[provider] || {};
    _renderReasoningBody(provider, cfg, { onAdvanced: _openSwitchSheet });
  };
  const shownKey = warm ? _pickerStateKey() : '';
  if (warm) render();
  await _refreshPickerData();
  if (!sheet?.isConnected || !sheet.classList.contains('is-reasoning')) return;
  const body = document.getElementById('pm-msheet-body');
  const stillOnSelector = !!body?.querySelector('#pm-reasoning-selector, .pm-msheet-loading');
  if (stillOnSelector && (!warm || _pickerStateKey() !== shownKey)) render();
}

function _renderReasoningBody(provider, cfg, { onAdvanced = _openSwitchSheet, onSave = null } = {}) {
  const options = _effortOptions(provider, cfg);
  const current = _normalizedReasoningEffort(provider, cfg.model, cfg.reasoning_effort);
  const selectedIndex = Math.max(0, options ? options.indexOf(current) : 0);
  const selectedProgress = options && options.length > 1 ? selectedIndex / (options.length - 1) : 0;
  _setSheetTitle('');
  const sheet = document.getElementById('pm-msheet');
  sheet?.__pmReasoningGestureDispose?.();
  if (sheet) sheet.__pmReasoningGestureDispose = null;
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
    if (document.getElementById('pm-msheet')?.__pmModelSheetRestoreFocus?.id === 'pm-composer-input') {
      // Slider gestures must not move focus off the textarea on iOS.
      control.addEventListener('pointerdown', (event) => event.preventDefault(), true);
    }
    control.setAttribute('aria-label', 'Reasoning level. Swipe left or right to adjust.');
    control.setAttribute('aria-orientation', 'horizontal');
    let lastIndex = selectedIndex;
    let requestGestureNativeHaptic = null;
    const indexMax = Math.max(1, options.length - 1);
    const setProgress = (progress) => {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      control.style.setProperty('--pm-reasoning-progress', String(safeProgress));
      control.style.setProperty('--pm-reasoning-fill-width', reasoningSliderFillWidth(safeProgress, options.length));
    };
    const commitIndex = (index, immediate = false, { snap = true, save = true } = {}) => {
      const safeIndex = Math.max(0, Math.min(options.length - 1, Number(index) || 0));
      const value = options[safeIndex] || '';
      const label = _effortLabel(value, provider, cfg.model);
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
        // The gesture surface moves one real native switch under the finger.
        // Request it once per crossed step; unchanged pointer moves request
        // no tick. pmHaptic remains the non-gesture fallback.
        const stepsCrossed = Math.abs(safeIndex - lastIndex);
        for (let tick = 0; tick < stepsCrossed; tick += 1) {
          // Only a gesture-surface callback puts the switch under the active
          // finger. pmHaptic is the fallback for taps/keyboard and platforms
          // without that native path.
          if (requestGestureNativeHaptic) requestGestureNativeHaptic();
          else pmHaptic(8);
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
    // Thumb centers sit on segment centers; map the finger onto them.
    const progressFromEvent = (event) => reasoningProgressFromPointer(event, control, options.length);
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
    // Both the visible control and the short-lived native switch sensor use
    // these handlers. The sensor produces real iOS ticks at level boundaries;
    // disposing it with the sheet prevents an old invisible hit target from
    // blocking the next opening.
    let activePointerId = null;
    const onPointerDown = (event, gesture) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      requestGestureNativeHaptic = gesture?.requestNativeHaptic || null;
      if (!gesture) event.preventDefault();
      activePointerId = event.pointerId;
      if (!gesture) { try { control.setPointerCapture?.(event.pointerId); } catch {} }
      control.classList.add('is-dragging');
      updateFromPointer(event);
      const restoreFocus = sheet?.__pmModelSheetRestoreFocus;
      if (restoreFocus?.id === 'pm-composer-input') {
        queueMicrotask(() => {
          if (restoreFocus.isConnected && document.activeElement !== restoreFocus) {
            try { restoreFocus.focus({ preventScroll: true }); } catch {}
          }
        });
      }
    };
    const onPointerMove = (event, gesture) => {
      if (event.pointerId !== activePointerId) return;
      requestGestureNativeHaptic = gesture?.requestNativeHaptic || requestGestureNativeHaptic;
      updateFromPointer(event);
    };
    const finishPointer = (event) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      control.classList.remove('is-dragging');
      if (Number.isFinite(event.clientX)) updateFromPointer(event, true);
      else commitIndex(lastIndex, true);
      requestGestureNativeHaptic = null;
    };
    control.addEventListener('pointerdown', onPointerDown);
    control.addEventListener('pointermove', onPointerMove);
    control.addEventListener('pointerup', finishPointer);
    control.addEventListener('pointercancel', finishPointer);
    if (sheet) {
      sheet.__pmReasoningGestureDispose = attachMobileHapticGestureSurface(control, {
        onPointerDown,
        onPointerMove,
        onPointerUp: finishPointer,
        onPointerCancel: finishPointer,
        onClick: () => {
          const restoreFocus = sheet.__pmModelSheetRestoreFocus;
          if (restoreFocus?.id === 'pm-composer-input' && restoreFocus.isConnected && document.activeElement !== restoreFocus) {
            try { restoreFocus.focus({ preventScroll: true }); } catch {}
          }
        },
        nativeHapticsOnMove: false,
      });
      // The sensor is positioned from the control's rect when it is attached,
      // but the sheet is still translated off-screen then (slide-up entrance)
      // and the control is scaled. Re-measure once the sheet has settled, or
      // the invisible switch sits below the viewport and iOS never ticks.
      const refreshSensor = () => sheet.__pmReasoningGestureDispose?.refresh?.();
      requestAnimationFrame(() => requestAnimationFrame(refreshSensor));
      setTimeout(refreshSensor, 180);
      setTimeout(refreshSensor, 420);
      sheet.addEventListener('transitionend', (event) => {
        if (event.target === sheet) refreshSensor();
      });
    }
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
  const sheet = _openSheet('', '<div class="pm-msheet-loading">Loading...</div>');
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
  const active = _activeModel(_llmCache);
  const model = String(merged.model || active.model || '').trim();
  if (merged.reasoning_effort) {
    const normalized = _normalizedReasoningEffort(provider, model, merged.reasoning_effort);
    if (normalized) merged.reasoning_effort = normalized;
    else delete merged.reasoning_effort;
  }
  if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
  _setComposerModelIdentity(provider, model, merged.reasoning_effort);
  _setBadgeLabel(formatModelWithReasoning(model, provider, merged.reasoning_effort));
  clearTimeout(_reasoningSaveTimer);
  const commit = () => {
    _reasoningSaveChain = _reasoningSaveChain.then(async () => {
      const route = await _loadChatModelRoute();
      const effective = route?.effective || { providerId: provider, model: merged.model || _activeModel(_llmCache).model };
      await _saveChatModelRoute({
        providerId: provider,
        model: merged.model || effective.model,
        reasoningEffort: merged.reasoning_effort || undefined,
        speed: supportsFastSpeed(provider, model) ? (merged.speed === 'fast' ? 'fast' : 'standard') : undefined,
        accountId: effective.accountId || undefined,
      });
      await refreshMobileModelBadge(true);
    }).catch((err) => _toast(err?.message || 'Could not save reasoning', 'error'));
  };
  if (immediate) commit();
  else _reasoningSaveTimer = setTimeout(commit, 180);
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Advanced: provider / model / intelligence controls ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
async function _openSwitchSheet() {
  const warm = !!(_llmCache && _catalogCache);
  const sheet = _openSheet('Advanced <span class="pm-msheet-chev">&rsaquo;</span>', warm ? '' : '<div class="pm-msheet-loading">Loading controls...</div>');
  sheet?.classList.add('is-model-switch');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-model-switch');
  sheet?.removeAttribute('style');
  const shownKey = warm ? _pickerStateKey() : '';
  if (warm) _renderAdvancedSheet();
  await _refreshPickerData();
  if (!sheet?.isConnected) return;
  const body = document.getElementById('pm-msheet-body');
  const stillOnAdvanced = !!body?.querySelector('.pm-advanced-panel, .pm-msheet-loading');
  if (stillOnAdvanced && (!warm || _pickerStateKey() !== shownKey)) _renderAdvancedSheet();
}

function _currentAdvancedState() {
  const { provider, model } = _activeModel(_llmCache);
  const cfg = (_llmCache?.providers || {})[provider] || {};
  const options = _effortOptions(provider, cfg);
  const effort = _normalizedReasoningEffort(provider, cfg.model || model, cfg.reasoning_effort);
  const effortValue = options && options.includes(effort) ? effort : (options ? options[0] : '');
  return { provider, model: cfg.model || model, cfg, options, effortValue };
}

function _advancedRow(label, value, action, { disabled = false } = {}) {
  return `
    <button type="button" class="pm-advanced-row" data-action="${_esc(action)}" ${disabled ? 'disabled' : ''}>
      <span class="pm-advanced-row-label">${_esc(label)}</span>
      <span class="pm-advanced-row-value">${_esc(value)}</span>
      <span class="pm-advanced-row-chev" aria-hidden="true">&rsaquo;</span>
    </button>`;
}

function _renderAdvancedSheet() {
  _setSheetTitle('Advanced <span class="pm-msheet-chev">&rsaquo;</span>');
  const { provider, model, cfg, options, effortValue } = _currentAdvancedState();
  const models = _modelsForProvider(provider);
  const speed = cfg.speed === 'fast' || cfg.fast_mode === true ? 'fast' : 'standard';
  const body = _setSheetBody(`
    <div class="pm-msheet-rows pm-native-picker-rows pm-advanced-panel">
      <button type="button" class="pm-msheet-row pm-native-picker-trigger" data-pm-model-picker ${models.length ? '' : 'disabled'}>
        <span class="pm-msheet-row-label">Model</span>
        <span class="pm-msheet-row-value">${_esc(prettifyModelName(model, provider))}</span>
        <span class="pm-msheet-chev" aria-hidden="true">&#8250;</span>
      </button>
      <button type="button" class="pm-msheet-row pm-native-picker-trigger" data-pm-effort-picker ${options ? '' : 'disabled'}>
        <span class="pm-msheet-row-label">Intelligence</span>
        <span class="pm-msheet-row-value">${_esc(options ? _effortLabel(effortValue, provider, model) : 'Default')}</span>
        <span class="pm-msheet-chev" aria-hidden="true">&#8250;</span>
      </button>
      ${supportsFastSpeed(provider, model) ? `<button type="button" class="pm-msheet-row pm-native-picker-trigger" data-pm-speed-picker><span class="pm-msheet-row-label">Speed</span><span class="pm-msheet-row-value">${speed === 'fast' ? 'Fast' : 'Standard'}</span><span class="pm-msheet-chev" aria-hidden="true">&#8250;</span></button>` : ''}
      <button type="button" class="pm-msheet-row pm-native-picker-trigger" data-pm-provider-picker><span class="pm-msheet-row-label">Provider</span><span class="pm-msheet-row-value">${_esc(_providerLabel(provider))}</span><span class="pm-msheet-chev" aria-hidden="true">&#8250;</span></button>
    </div>`);
  if (!body) return;
  const attach = (trigger, config) => {
    if (!trigger) return null;
    const picker = attachNativePicker(trigger, config);
    picker.select?.parentElement?.style.setProperty('width', '100%');
    picker.select?.addEventListener('change', () => pmHaptic(8));
    return picker;
  };
  attach(body.querySelector('[data-pm-provider-picker]'), {
    label: 'Provider',
    options: () => {
      const active = _activeModel(_llmCache).provider;
      const ids = (_credentialedIds || []).slice();
      if (active && !ids.includes(active)) ids.unshift(active);
      return ids.map(value => ({ value, label: _providerLabel(value), selected: value === active }));
    },
    onChange: async value => {
      const nextProvider = String(value || '');
      const existing = (_llmCache?.providers || {})[nextProvider] || {};
      const nextModel = existing.model || _modelsForProvider(nextProvider)[0] || '';
      if (nextModel) await _switchModel(nextProvider, nextModel, { keepOpen: true, returnToAdvanced: true });
    },
  });
  attach(body.querySelector('[data-pm-model-picker]'), {
    label: 'Model',
    options: () => {
      const currentState = _currentAdvancedState();
      return _modelsForProvider(currentState.provider).map(value => ({
        value,
        label: prettifyModelName(value, currentState.provider),
        selected: value === currentState.model,
      }));
    },
    onChange: value => _switchModel(provider, String(value || ''), { keepOpen: true, returnToAdvanced: true }),
  });
  attach(body.querySelector('[data-pm-effort-picker]'), {
    label: 'Intelligence',
    options: () => {
      const state = _currentAdvancedState();
      return (state.options || []).map(value => ({
        value,
        label: _effortLabel(value, state.provider, state.model),
        selected: value === state.effortValue,
      }));
    },
    onChange: value => {
      const effort = String(value || '');
      _queueReasoningSave(provider, { reasoning_effort: effort }, true);
      const merged = { ...cfg, reasoning_effort: effort };
      if (!effort) delete merged.reasoning_effort;
      if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
      _renderAdvancedSheet();
    },
  });
  attach(body.querySelector('[data-pm-speed-picker]'), {
    label: 'Speed',
    options: () => ['standard', 'fast'].map(value => ({ value, label: value === 'fast' ? 'Fast' : 'Standard', selected: value === speed })),
    onChange: value => {
      const nextSpeed = value === 'fast' ? 'fast' : 'standard';
      _queueReasoningSave(provider, { speed: nextSpeed }, true);
      const merged = { ...cfg, speed: nextSpeed }; delete merged.fast_mode;
      if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
      _setBadgeFast(nextSpeed === 'fast');
      _renderAdvancedSheet();
    },
  });
}

async function _switchModel(provider, model, { keepOpen = false, returnToAdvanced = false } = {}) {
  if (!provider || !model) return;
  try {
    const current = await _loadChatModelRoute();
    await _saveChatModelRoute({
      providerId: provider,
      model,
      reasoningEffort: current?.effective?.providerId === provider ? current.effective.reasoningEffort || undefined : undefined,
      speed: current?.effective?.providerId === provider ? current.effective.speed || undefined : undefined,
      accountId: current?.effective?.providerId === provider ? current.effective.accountId || undefined : undefined,
    });
    window.__pmChatModelRoute = await _loadChatModelRoute();
    const nextCfg = { ...((_llmCache?.providers || {})[provider] || {}), model, reasoning_effort: window.__pmChatModelRoute?.effective?.reasoningEffort };
    _toast(`Model -> ${prettifyModelName(model, provider)}`, 'success');
    await refreshMobileModelBadge(false, { provider, model });
    try {
      window.dispatchEvent(new CustomEvent('pm-model-changed', {
        detail: { provider, model, sessionId: _activeChatSessionId(), sourceEventType: 'model_switched', fromSelector: true },
      }));
    } catch {}
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
    if (badge.classList.contains('pm-composer-model-badge')) {
      const keepKeyboard = badge.dataset.pmKeepKeyboard === '1';
      delete badge.dataset.pmKeepKeyboard;
      if (keepKeyboard) {
        const input = document.getElementById('pm-composer-input');
        try { input?.focus({ preventScroll: true }); } catch { input?.focus(); }
      }
    }
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
  window.addEventListener('pm-mobile-session-changed', (event) => {
    const detail = event?.detail || {};
    refreshMobileModelBadge(true, { ...detail, sourceEventType: 'session_changed' }).catch(() => {});
  });

  refreshMobileModelBadge(true).catch(() => {});

  // Warm the picker's data so the first tap on the badge opens instantly.
  // iOS Safari has no requestIdleCallback, so fall back to a short delay.
  const prefetchPicker = () => {
    Promise.all([_loadCatalog(false), _loadCredentialedIds(false), _loadUsage(false)]).catch(() => {});
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(prefetchPicker, { timeout: 3000 });
  else setTimeout(prefetchPicker, 1500);
}
