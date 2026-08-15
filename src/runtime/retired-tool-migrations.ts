const DIRECT_TEAM_CATEGORY_POLICY = `TEAMS: activate agents_and_teams and orchestrate team work directly from the main Prometheus agent. Standalone one-off work can use agent_ops/spawn_subagent plus agent_chat_ops; managed multi-agent work uses team_ops_wrapper and team_collab_ops.
WHEN TO USE EACH:
  → chat_with_subagent or agent_chat_ops(action:"chat"): direct conversation/check-in with a known standalone non-team agent
  → agent_chat_ops(action:"delegate"): exactly one new standalone formal task; action:"steer": an existing active task; action:"send_mailbox": delivery without starting work
  → agent_ops(action:"spawn") or spawn_subagent(..., run_now=false): create/ensure specialists without starting work
  → team_ops_wrapper(action:"manage", team_action:"create"|"start"|"update"|"pause"|"resume"|"delete"|"list"): managed team lifecycle
  → team_ops_wrapper(action:"dispatch"|"request_member_turn"|"get_agent_result"|"post_chat"|"reply"|"manage_goal"|"manage_context_ref"): managed team execution and coordination
  → team_collab_ops(...): teammate/manager collaboration inside a team
MULTI-AGENT FLOW: Prometheus itself chooses useful roles, creates or reuses the needed subagents, creates the managed team, and starts/dispatches it when the user's request calls for execution. Do not add a separate meta-coordinator agent just to create or operate the team.
TEAM OPS: Prefer the wrapper surface. ask_team_coordinator is retired and must not be called. Granular team_manage remains a compatibility handler for older persisted runs, not the normal model-facing route.`;

const DIRECT_TEAM_CORE_POLICY = `[TEAMS & AGENTS] Agent/task routes — activate agents_and_teams, then pick the right one:
  → chat_with_subagent(id,message) — normal persistent chat/check-in with a known standalone non-team agent.
  → agent_run_ops(action:"list"|"get"|"steer"|"recover"|"resume"|"rerun",...) — existing unfinished/failed subagent/team-agent runs. Use steer for live instruction changes and recover only for paused/stalled recovery chat. Completed subagent tasks cannot be reopened.
  → agent_ops(action:"spawn", ...) / spawn_subagent(..., run_now=false) — create or ensure a standalone specialist without starting work; agent_chat_ops(action:"delegate", agent_id, assignment) starts exactly one new formal standalone task.
  → team_ops_wrapper(action:"manage", team_action:"create"|"start"|"update"|"pause"|"resume"|"delete"|"list", ...) — create and operate managed teams directly from main Prometheus. For a complex multi-agent goal, Prometheus itself chooses roles, creates/reuses the needed subagents, creates the team, and starts or dispatches it as appropriate.
  → team_ops_wrapper(action:"dispatch"|"request_member_turn"|"get_agent_result"|"post_chat"|"reply"|"manage_goal"|"manage_context_ref", ...) and team_collab_ops(...) — execution, results, shared-room communication, goals/context, and collaboration.
There is no meta-coordinator handoff. ask_team_coordinator is retired. Prefer wrapper tools; granular team_manage remains compatibility-only for old persisted work.`;

/**
 * Compatibility migration for prompt snapshots while the old coordinator text
 * still exists in historical prompt source. New model-facing tool contexts must
 * never instruct Prometheus to hand managed-team work to ask_team_coordinator.
 *
 * Keeping this normalization at the prompt snapshot boundary also protects old
 * cached/static prompt variants without deleting the persistent per-team manager
 * runtime used by existing managed teams.
 */
export function rewriteRetiredToolPromptText(value: string): string {
  let text = String(value || '');

  text = text.replace(
    /TEAMS: activate agents_and_teams, then use ask_team_coordinator\(goal, context\?\) for multi-agent team work\.[\s\S]*?TEAM OPS: Do NOT call granular team_manage directly from main chat\. Use ask_team_coordinator for normal managed team work; use team_ops_wrapper\/team_collab_ops only when you intentionally need lower-level managed-team operations\./g,
    DIRECT_TEAM_CATEGORY_POLICY,
  );

  text = text.replace(
    /\[TEAMS & AGENTS\] Agent\/task routes — activate agents_and_teams, then pick the right one:[\s\S]*?Do NOT call team_manage directly\. reply_to_team\(team_id, msg\) is the only direct team call — use only when a coordinator is waiting on your reply\./g,
    DIRECT_TEAM_CORE_POLICY,
  );

  return text;
}

export const RETIRED_TEAM_COORDINATOR_PROMPT_MARKER = 'ask_team_coordinator';
