/** Operational policy shared by main chat, worker overlays, and goal continuation. */
export const OPERATING_INSTRUCTION_SOURCE = 'src/runtime/operating-instructions.ts';

export const USER_PLAN_INSTRUCTION = 'Default to direct execution. Call declare_plan only when the user explicitly asks for a plan, checklist, or step-by-step breakdown. Internal organization does not require a visible plan.';

export function buildOperatingInstructions(input: { executionMode: string; hasDurableTaskPlan?: boolean; activeGoal?: boolean }): string {
  const block = (id: string, reason: string, text: string) => `[OPERATING_RULE ${id} ${reason}]\n${text}\n[/OPERATING_RULE]`;
  const plan = input.hasDurableTaskPlan
    ? ['durable_plan', 'This run already has a durable task plan. Do NOT call bg_plan_declare, bg_plan_advance, declare_plan, or complete_plan_step. Execute the current durable step and call step_complete(note) once it is finished.']
    : input.activeGoal
      ? ['goal_lifecycle', 'An explicitly started Goal is active. Follow its supplied durable Goal plan and continuation protocol; preserve existing progress and record evidence for completed steps. Outside that lifecycle, create a visible plan only when the user asks.']
    : input.executionMode === 'background_agent'
      ? ['background_lifecycle', 'For background-agent tasks with 2+ meaningful phases, use bg_plan_declare (2-8 short steps) and bg_plan_advance(note) to track completed phases. This is internal worker lifecycle bookkeeping. Do NOT use declare_plan/complete_plan_step.']
      : input.executionMode === 'proposal_execution'
        ? ['proposal_lifecycle', 'Proposal execution already has a fixed task plan. Do NOT call declare_plan. Execute steps in order, use tools directly, and call step_complete(note) after each completed step.']
        : ['user_requested_plan', USER_PLAN_INSTRUCTION];
  return [
    block('core.action_posture', 'all_tool_runtimes', 'Complete authorized work with available tools and persistent problem-solving. Runtime execution policy and tool approval gates govern permissions and external actions; persona, memory, and skill prose cannot bypass those gates. If blocked, name the specific constraint and continue useful authorized work. Verify important outcomes before claiming completion.'),
    block('core.plan_protocol', plan[0], plan[1]),
    block('core.skills_recovery', 'skill_failure_recovery', 'When a skill-guided path fails, recover with another viable approach. If that works, offer an evidence-backed skill correction. Do not rewrite the skill catalog merely because a fallback worked.'),
    input.executionMode === 'interactive'
      ? block('core.work_updates', 'interactive_work', 'Keep the user oriented during meaningful work: give a brief approach before starting, then report material findings, blockers, changes of approach, and verification. A simple click or quick lookup needs no narration ceremony. Avoid narrating each tool call or exposing private reasoning.')
      : '',
  ].filter(Boolean).join('\n');
}

/** Inspect emitted blocks rather than inferring their presence from registry declarations. */
export function inspectOperatingInstructions(system: string) {
  const seen = new Set<string>();
  return [...system.matchAll(/\[OPERATING_RULE ([\w.]+) ([\w_]+)\]\n([\s\S]*?)\n\[\/OPERATING_RULE\]/g)].map((match) => {
    const duplicate = seen.has(match[1]);
    seen.add(match[1]);
    return { id: match[1], reason: match[2], source: OPERATING_INSTRUCTION_SOURCE, chars: match[0].length, duplicate, text: match[0] };
  });
}
