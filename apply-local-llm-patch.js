/**
 * apply-local-llm-patch.js
 * One-shot patch script — applies the 3 local-LLM edits to chat.router.ts.
 * Run with: node apply-local-llm-patch.js
 * Delete this file after running.
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src/gateway/routes/chat.router.ts');
let content = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

let applied = 0;

// ── Edit 1: isLocalPrimary flag after primaryProvider ────────────────────────
const E1_OLD = `  const primaryProvider = rawCfgForPreempt.llm?.provider || 'ollama';\n  const preemptCfg:`;
const E1_NEW = `  const primaryProvider = rawCfgForPreempt.llm?.provider || 'ollama';
  // ── Local LLM primary detection (v2.0 local model layer) ──────────────────
  // True when the configured primary is Ollama, LM Studio, or llama.cpp.
  // Gates the local_llm prompt path and the switch_model full-prompt promotion.
  // Cloud-primary sessions are completely unaffected — this flag is false for them.
  const isLocalPrimary = ['ollama', 'llama_cpp', 'lm_studio'].includes(
    String(primaryProvider || '').trim().toLowerCase(),
  );
  const preemptCfg:`;

if (content.includes(E1_OLD)) {
  content = content.replace(E1_OLD, E1_NEW);
  console.log('Edit 1 (isLocalPrimary flag): OK');
  applied++;
} else if (content.includes('isLocalPrimary')) {
  console.log('Edit 1: already applied, skipping');
} else {
  console.error('Edit 1: FAILED — anchor not found');
}

// ── Edit 2: Pass local_llm profile to initial buildPersonalityContext ─────────
const E2_OLD = `    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
  );
  let switchModelPersonalityCtx: string | null = null;`;
const E2_NEW = `    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
    // local_llm: tiny prompt for small model primaries; cloud primaries use default (full)
    isLocalPrimary ? { profile: 'local_llm' } : undefined,
  );
  let switchModelPersonalityCtx: string | null = null;`;

if (content.includes(E2_OLD)) {
  content = content.replace(E2_OLD, E2_NEW);
  console.log('Edit 2 (local_llm profile pass): OK');
  applied++;
} else if (content.includes("profile: 'local_llm'")) {
  console.log('Edit 2: already applied, skipping');
} else {
  console.error('Edit 2: FAILED — anchor not found');
}

// ── Edit 3: Local primary switch_model promotion in turn_override branch ──────
const E3_OLD = `      if (generationOverride.source === 'turn_override') {
        if (!switchModelPersonalityCtx) {
          switchModelPersonalityCtx = await buildPersonalityContext(
            sessionId,
            workspacePath,
            message,
            executionMode || 'interactive',
            history.length,
            _skillsManager,
            browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
            { profile: 'switch_model' },
          );
        }
        if (messages[0]?.role === 'system') messages[0].content = buildSystemPrompt('switch_model');
      }`;
const E3_NEW = `      if (generationOverride.source === 'turn_override') {
        // ── Local primary switch_model promotion ──────────────────────────────────
        // When primary is a local LLM, the switched cloud model must receive the full
        // v1 Prometheus prompt (buildSystemPrompt('full')) so it operates as complete
        // Prometheus. personalityCtx (already computed above) has the full context.
        // For cloud primaries the existing lightweight switch_model path is unchanged.
        if (!isLocalPrimary && !switchModelPersonalityCtx) {
          switchModelPersonalityCtx = await buildPersonalityContext(
            sessionId,
            workspacePath,
            message,
            executionMode || 'interactive',
            history.length,
            _skillsManager,
            browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
            { profile: 'switch_model' },
          );
        }
        if (messages[0]?.role === 'system') messages[0].content = isLocalPrimary
          ? buildSystemPrompt('full')         // cloud model gets complete Prometheus runtime
          : buildSystemPrompt('switch_model'); // cloud primary: existing lightweight path
      }`;

if (content.includes(E3_OLD)) {
  content = content.replace(E3_OLD, E3_NEW);
  console.log('Edit 3 (switch_model promotion): OK');
  applied++;
} else if (content.includes('!isLocalPrimary && !switchModelPersonalityCtx')) {
  console.log('Edit 3: already applied, skipping');
} else {
  console.error('Edit 3: FAILED — anchor not found');
}

if (applied > 0) {
  // Preserve original line endings (CRLF for Windows)
  fs.writeFileSync(TARGET, content.replace(/\n/g, '\r\n'), 'utf8');
  console.log(`\nWrote ${applied} edit(s) to ${TARGET}`);
} else {
  console.log('\nNo edits applied (all already present or anchors missing).');
}

console.log('\nDone. Delete this file: node -e "require(\'fs\').unlinkSync(\'apply-local-llm-patch.js\')"');
