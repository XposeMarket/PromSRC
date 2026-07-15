const OPENAI_PROVIDER_IDS = new Set(['openai', 'openai_codex']);

function titleWord(value) {
  const text = String(value || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}

export function formatReasoningDisplayName(effort) {
  const value = String(effort || '').trim().toLowerCase();
  if (!value || value === 'default' || value === 'provider_default') return '';
  if (value === 'xhigh' || value === 'extra_high') return 'Extra High';
  return titleWord(value);
}

export function formatModelDisplayName(model, provider = '') {
  const rawRef = String(model || '').trim();
  const slash = rawRef.indexOf('/');
  const raw = slash > 0 ? rawRef.slice(slash + 1) : rawRef;
  const providerId = String(provider || (slash > 0 ? rawRef.slice(0, slash) : '')).trim().toLowerCase();
  if (!raw) return 'Model';

  const lower = raw.toLowerCase();
  const gpt56 = lower.match(/^gpt-5\.6-(sol|terra|luna)(?:-|$)/);
  if (gpt56 && OPENAI_PROVIDER_IDS.has(providerId)) return `5.6 ${titleWord(gpt56[1])}`;
  if (lower === 'gpt-5.3-codex-spark' && providerId === 'openai_codex') return '5.3 Spark';

  let value = lower
    .replace(/-?20\d{6}\b/g, '')
    .replace(/-(reasoning|non-reasoning|latest|preview|exp|instruct|thinking|online)\b/g, '')
    .replace(/-\d{4}\b/g, '')
    .replace(/^claude-/, '')
    .replace(/(\d)-(\d)/g, '$1.$2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) value = raw;

  if (/^gpt\b/.test(value)) value = value.replace(/^gpt\b/i, 'GPT');
  else if (/^o\d\b/.test(value)) value = value.toUpperCase();
  else if (providerId === 'anthropic' || /^(opus|sonnet|haiku)\b/.test(value)) value = value.replace(/^(opus|sonnet|haiku)\b/i, 'Claude $1');
  else if (providerId === 'gemini' || /^gemini\b/.test(value)) value = value.replace(/^gemini\b/i, 'Gemini');
  else if (providerId === 'xai' || /^grok\b/.test(value)) value = value.replace(/^grok\b/i, 'Grok');
  else if (providerId === 'perplexity' || /^sonar\b/.test(value)) value = value.replace(/^sonar\b/i, 'Sonar');
  else value = value.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

  return value
    .replace(/\bmini\b/gi, 'mini')
    .replace(/\b(Pro|Flash|Lite|Build|Codex|Max|Haiku|Opus|Sonnet|Deep|Research|Multi|Agent|Spark|Sol|Terra|Luna)\b/gi, titleWord)
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatModelWithReasoning(model, provider = '', effort = '') {
  const modelLabel = formatModelDisplayName(model, provider);
  const reasoningLabel = formatReasoningDisplayName(effort);
  return reasoningLabel ? `${modelLabel} ${reasoningLabel}` : modelLabel;
}

export function relabelModelSelect(select, provider = '') {
  if (!select || select.tagName !== 'SELECT') return;
  for (const option of Array.from(select.options || [])) {
    const value = String(option.value || '').trim();
    if (value) option.textContent = formatModelDisplayName(value, provider);
  }
}
