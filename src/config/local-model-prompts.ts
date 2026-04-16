/**
 * local-model-prompts.ts
 *
 * v2.0 prompt layer for local small-model primaries (Ollama / LM Studio / llama.cpp).
 *
 * These prompts are ADDITIVE — they activate only when the configured primary
 * provider is a local LLM. All existing cloud-primary prompt paths are untouched.
 *
 * Design goal: keep the local model's system prompt under ~300 tokens so that
 * even a 1.7b Qwen running at 2k context has ample room for conversation history
 * and the current user message.
 *
 * The local model's sole jobs:
 *   1. Converse naturally with the user.
 *   2. Call write_note(content) to save anything worth remembering.
 *   3. Call switch_model(tier) to hand execution work to a capable cloud model.
 *
 * When switch_model fires, the cloud model receives the full v1 Prometheus
 * runtime prompt (buildSystemPrompt('full') in chat.router.ts) — it acts as
 * complete Prometheus without any special instructions from this file.
 */

import fs from 'fs';
import path from 'path';

// ─── Provider detection ───────────────────────────────────────────────────────

/** Local LLM provider IDs — these are the values set in config llm.provider */
const LOCAL_PROVIDERS = new Set(['ollama', 'llama_cpp', 'lm_studio']);

/**
 * Returns true when the configured primary provider is a local LLM.
 * This is the single gate that activates the entire v2.0 path.
 */
export function isLocalPrimary(cfg: any): boolean {
  const provider = String(cfg?.llm?.provider || '').trim().toLowerCase();
  return LOCAL_PROVIDERS.has(provider);
}

// ─── Condensed USER.md loader ─────────────────────────────────────────────────

/**
 * Reads USER.md and returns a condensed version safe for a tiny context window.
 *
 * Strategy: take the last N section headers (##) and the first line of each.
 * This preserves the most recently written preferences/context while staying
 * well under 300 chars total.
 */
export function loadCondensedMemoryProfile(
  workspacePath: string,
  maxSections = 3,
  maxCharsPerSection = 80,
  hardCapChars = 300,
): string {
  try {
    const filePath = path.join(workspacePath, 'USER.md');
    if (!fs.existsSync(filePath)) return '';
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return '';

    // Split on ## headers
    const sections = raw.split(/^##\s+/m).filter(Boolean);
    if (!sections.length) {
      // No headers — just return the first hardCapChars chars
      return raw.slice(0, hardCapChars).trim();
    }

    // Take the last maxSections (most recently written) and condense each
    const recent = sections.slice(-maxSections);
    const condensed = recent.map((section) => {
      const lines = section.split('\n').filter((l) => l.trim());
      const header = lines[0] ? `## ${lines[0].trim()}` : '';
      const body = lines[1] ? lines[1].trim().slice(0, maxCharsPerSection) : '';
      return body ? `${header}\n${body}` : header;
    }).filter(Boolean);

    const result = condensed.join('\n').slice(0, hardCapChars);
    return result.trim();
  } catch {
    return '';
  }
}

// ─── Local model system prompt builder ───────────────────────────────────────

/**
 * Builds the minimal system prompt for the local small model.
 *
 * All parameters are injected at call time (not read from disk here) so that
 * the caller (chat.router.ts buildPersonalityContext) controls timing.
 *
 * @param timeString  - Human-readable current time, e.g. "Monday Apr 7 2025, 9:42 AM"
 * @param userMemory  - Output of loadCondensedMemoryProfile(), may be empty string
 * @returns           - Complete personality context block appended to baseSystemPrompt
 */
export function buildLocalModelPersonalityCtx(
  timeString: string,
  userMemory: string,
): string {
  const memoryBlock = userMemory
    ? `\n\n[USER]\n${userMemory}`
    : '';

  // Delegation instructions — single tool call, two values, plain English.
  // This is the entire job description for the local model re: tool use.
  const delegationBlock = `
[HOW TO DELEGATE]
You handle conversation. For anything that requires execution — code, files, browser,
desktop, research, automation — hand it off by calling switch_model first:
  • switch_model('high') → complex tasks, code, analysis, multi-step work
  • switch_model('low')  → quick lookups, memory writes, simple summaries
After calling switch_model, briefly tell the user what you're handing off. That's it.
The switched model picks up automatically with full context and handles the rest.

[MEMORY]
Use write_note(content) to save anything worth remembering between sessions.`.trim();

  return `\n\nCurrent time: ${timeString}${memoryBlock}\n\n${delegationBlock}`;
}

/**
 * Formats the current time in a compact, human-readable string.
 * Injected directly into the prompt — no time_now tool call needed.
 */
export function formatLocalModelTime(): string {
  return new Date().toLocaleString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
    hour:    'numeric',
    minute:  '2-digit',
    hour12:  true,
  });
}
