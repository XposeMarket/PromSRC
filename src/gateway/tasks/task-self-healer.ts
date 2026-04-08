/**
 * task-self-healer.ts
 *
 * Completion verifier for background task execution.
 * Called after the final synthesis round to validate the output before delivery.
 *
 * The error healer (callErrorHealer) has been removed — step verification is now
 * handled by the agent itself via the step_complete tool. No external auditor needed.
 */

import { buildPrimaryLlm } from '../llm-primary';
import { contentToString } from '../../providers/content-utils';
import type { TaskRecord } from './task-store';

// ─── Public constants ──────────────────────────────────────────────────────────

/** Kept for any code that imports this — no longer used by the runner. */
export const MAX_HEAL_ATTEMPTS = 2;

// ─── Decision types ────────────────────────────────────────────────────────────

export type CompletionVerifyDecision =
  | { action: 'DELIVER'; message: string; reasoning: string }
  | { action: 'RESYNTH'; hint: string; reasoning: string }
  | { action: 'DELIVER_ANYWAY'; message: string; reasoning: string };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonObject(raw: string): any | null {
  const clean = String(raw || '').replace(/```json|```/g, '').trim();
  if (!clean) return null;
  try { return JSON.parse(clean); } catch { return null; }
}

async function buildHealerProvider(): Promise<{ provider: any; model: string } | null> {
  return buildPrimaryLlm();
}

// ─── COMPLETION VERIFIER ───────────────────────────────────────────────────────

const COMPLETION_VERIFIER_SYSTEM = `You are a background task completion verifier.

A background task has finished all its planned steps and produced a final response.
Your job is to verify that the response is actually complete and correct before it is
delivered to the user.

You will receive:
- The original task prompt (what the user asked for)  
- The final response the AI produced
- A summary of what steps were taken

YOUR DECISION — choose exactly one:

1. DELIVER — The response correctly and completely answers the user's original request.
   Use this whenever the response is genuinely useful, even if it could be marginally improved.
   
2. RESYNTH — The response is clearly incomplete, cut off, or misses the point of the request.
   Only use this when there is a meaningful gap. Provide a specific hint for re-synthesis.
   
3. DELIVER_ANYWAY — The response is imperfect but good enough, and we should not waste
   another round on it. Use this if RESYNTH was already attempted or the response has real content.

Return ONLY valid JSON:
{
  "action": "DELIVER" | "RESYNTH" | "DELIVER_ANYWAY",
  "reasoning": "one concise sentence",
  // for DELIVER and DELIVER_ANYWAY:
  "message": "the final message to deliver — can be the original or a lightly cleaned version",
  // for RESYNTH:
  "hint": "specific instruction to improve the synthesis"
}

Rules:
- If the response has actual content that addresses the request, prefer DELIVER
- Do NOT nitpick style or length — only fail responses that are genuinely broken/empty
- Return JSON only`;

/**
 * Called after the synthesis round completes, before delivering to the user.
 * Verifies the final output is actually good before it goes to chat/Telegram.
 */
export async function callCompletionVerifier(input: {
  task: TaskRecord;
  finalMessage: string;
  resynthAttempt: number;
}): Promise<CompletionVerifyDecision> {
  // After one resynth attempt, just deliver whatever we have
  if (input.resynthAttempt >= 1) {
    return { action: 'DELIVER_ANYWAY', message: input.finalMessage, reasoning: 'Already attempted re-synthesis — delivering existing output.' };
  }

  // If the message is clearly empty/broken, ask for a resynth immediately
  if (!input.finalMessage || input.finalMessage.trim().length < 20) {
    return { action: 'RESYNTH', hint: 'The response was empty or too short. Produce a complete answer to the original request.', reasoning: 'Final message was empty or too short to deliver.' };
  }

  const built = await buildHealerProvider();
  if (!built) {
    return { action: 'DELIVER', message: input.finalMessage, reasoning: 'No LLM — delivering without verification.' };
  }

  const { provider, model } = built;

  const completedSteps = input.task.plan
    .filter(s => s.status === 'done' || s.status === 'skipped')
    .map(s => `  ✓ ${s.description}${s.notes ? `: ${s.notes.slice(0, 100)}` : ''}`)
    .join('\n');

  const prompt = `ORIGINAL TASK PROMPT:
"${input.task.prompt.slice(0, 400)}"

COMPLETED STEPS:
${completedSteps || '(no steps recorded)'}

FINAL RESPONSE TO VERIFY:
${input.finalMessage.slice(0, 1500)}

Does this response correctly and completely address the original task prompt?
Return JSON only.`;

  try {
    const result = await provider.chat(
      [
        { role: 'system', content: COMPLETION_VERIFIER_SYSTEM },
        { role: 'user', content: prompt },
      ],
      model,
      { max_tokens: 400 },
    );

    const raw = contentToString(result.message.content).trim();
    const parsed = parseJsonObject(raw);
    if (!parsed || !parsed.action) {
      return { action: 'DELIVER', message: input.finalMessage, reasoning: 'Verifier response was unparseable — delivering as-is.' };
    }

    const action = String(parsed.action || '').toUpperCase();
    const reasoning = String(parsed.reasoning || '').slice(0, 300);

    if (action === 'RESYNTH') {
      return {
        action: 'RESYNTH',
        hint: String(parsed.hint || 'Improve the final response to better address the original request.').slice(0, 500),
        reasoning,
      };
    }

    const message = (parsed.message && String(parsed.message).trim().length > 20)
      ? String(parsed.message).slice(0, 4000)
      : input.finalMessage;

    return {
      action: action === 'DELIVER_ANYWAY' ? 'DELIVER_ANYWAY' : 'DELIVER',
      message,
      reasoning,
    };
  } catch (err: any) {
    console.error('[SelfHealer] Completion verifier call failed:', err.message);
    return { action: 'DELIVER', message: input.finalMessage, reasoning: `Verifier threw: ${err.message.slice(0, 100)} — delivering as-is.` };
  }
}
