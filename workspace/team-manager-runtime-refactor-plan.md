# Team Manager Runtime Refactor Plan

Date: 2026-04-11

## Goal

Simplify and harden the Prometheus team system by separating team creation from team management, making manager runtime prompts explicit, and adding a final Prometheus review loop whenever a team manager declares `[GOAL_COMPLETE]`.

The intended end state:

- `ask_team_coordinator` creates/configures teams and then stops.
- Team managers run in a dedicated `team_manager` mode with a small, predictable prompt.
- Teams have a durable `team_info.md` injected on every manager run.
- Subagent results trigger manager verification instead of blind acceptance.
- `[GOAL_COMPLETE]` hands a structured completion packet to the main Prometheus chat agent.
- Prometheus verifies team output against the originating chat session and either accepts, re-runs, or both.

## Current Problems Observed

During team creation for the Xpose Market lead-generation team:

- The meta-coordinator created agents and the team, but then kept working after returning `ask_team_coordinator` output.
- It created a richer `workspace/xpose-lead-gen-setup.md` file while the team workspace kickoff summary was weaker or separate.
- It ran useful memory search late, after the team was already created.
- It tried irrelevant follow-up actions like reading `workspace/events/pending.json`, checking tasks, and calling `agent_info` on a team ID.
- Team manager runtime currently uses generic `background_task` execution and a large hardcoded coordinator prompt.
- `team.manager.systemPrompt` is stored but not meaningfully injected into active manager runtime.
- Team completion does not yet have a strong main-agent verification handoff that checks the original user intent from the originating chat session.

## Runtime Split

### 1. Meta-Coordinator / Team Creator

This is the short-lived runtime used by `ask_team_coordinator`.

Responsibilities:

- Understand the user's team creation goal.
- Run a memory/context preflight before creating anything.
- Create or reuse appropriate subagents.
- Create the managed team.
- Create team context references.
- Write the durable `team_info.md`.
- Return a setup summary to the main chat agent.
- Stop immediately after returning the setup summary.

Non-responsibilities:

- Do not start the team automatically.
- Do not inspect random files or tasks after returning the setup summary.
- Do not continue into operational team-management work.
- Do not create unrelated setup files outside the team workspace.

Required behavior:

1. Start with memory preflight:
   - Run `memory_search` against the user goal and supplied context.
   - Pull relevant business/user memory snippets when available.
   - Use this to enrich team purpose, role specializations, and context references.
2. Create subagents using `spawn_subagent(..., run_now=false)`.
3. Create team using `team_manage(action="create")`.
4. Write `team_info.md` inside the new team workspace.
5. Add useful team context reference cards in the Teams UI context system.
6. Return a concise setup result:
   - team name
   - team ID
   - agents created
   - durable purpose
   - first-pass operating approach
   - ask: "Would you like me to initiate the team now? If yes, what should the first task be?"
7. Stop.

### 2. Team Manager

This is the ongoing manager runtime for an existing team.

It should use a dedicated execution mode:

```text
team_manager
```

The manager should not be a generic `background_task` with a giant inherited prompt. It should get a small and explicit runtime.

Base manager context:

```text
=== MANAGER MODE ===
You are acting as the Manager for the team: "<team name>" (ID: <teamId>)
Team workspace: <team workspace path>

Current task:
Current focus:
Team mode:
Recent completed work:
Milestones:

Subagents on this team:
- <agent name> (id: <agentId>) [PAUSED?]: <description>

Team info:
<team_info.md>

Team memory:
<memory.json>
<last_run.json>
<pending.json>

Recent team chat / manager inbox:
<relevant recent messages>
```

Manager rules:

- Dispatch subagents only when useful.
- Do not launch all subagents by default.
- Verify subagent results before accepting them.
- Check files created or modified by subagents when relevant.
- Update `memory.json`, `last_run.json`, and `pending.json`.
- Write outputs only inside the team workspace.
- Use `message_main_agent` for blockers or questions requiring Prometheus/user-level context.
- Use `[GOAL_COMPLETE]` only when the current task is substantively done.
- Use `[NEEDS_INPUT]` only when a decision is required.
- Use `[WAITING_MAIN_AGENT]` after messaging the main agent and waiting for reply.

## `team_info.md`

Replace "kickoff summary" with a durable `team_info.md`.

Location:

```text
<team workspace>/team_info.md
```

Injected:

- On every manager run.
- Optionally into subagent dispatch context as a compact reference if useful.

Contents:

- Team name and ID.
- Enduring purpose / mandate.
- Business/project context.
- What the team is for.
- What the team should not do.
- Subagent roster and role rationale.
- Operating style.
- Quality bar / definition of done.
- Target outputs.
- Known constraints.
- Useful memory/context discovered during creation.
- Important workspace files and what they are for.

Migration idea:

- For existing teams, if a richer setup file exists, copy or merge it into `team_info.md`.
- For the Xpose Market lead-generation team, use the current richer setup document as the basis for `team_info.md`.

## Trigger-Specific Manager Prompts

All triggers use the same base manager context, then append a short immediate prompt.

### First Run / Run Button

```text
[TEAM FIRST RUN]
Proceed with dispatching the right subagents for the current task. Use team_info.md and team memory. Do not launch every subagent by default.
```

### Direct Team Chat

```text
[TEAM OWNER MESSAGE]
<user message>
```

### Main Agent Message

```text
[MAIN AGENT MESSAGE]
<message>
```

### Subagent Result Review

```text
[SUBAGENT RESULT TO VERIFY]
You dispatched <agentId> for:
<manager dispatch prompt>

The agent returned:
<agent result>

Verify/analyze the work. Check files created or modified by the agent if relevant. If the output is incomplete, re-dispatch with a specific fix. If accepted, update memory.json and last_run.json.
```

This should be a dedicated manager turn after a subagent returns, not just a passive chat entry the manager may or may not notice.

## Manager Tool Access And Sandboxing

Managers should have tools appropriate to team operation:

- Team ops tools as core:
  - dispatch subagent
  - talk to subagent
  - manage team goal
  - manage context references
  - message main agent
- File read/write scoped to the team workspace.
- `memory_search`.
- Special read-only access to root workspace memory:
  - `USER.md`
  - `SOUL.md`
  - `MEMORY.md`
  - business/project memory where appropriate.
- Source read tools as needed for code-review teams.
- Source write should remain proposal-gated unless a narrow low-risk path is explicitly allowed.

Managers should not have broad unsandboxed file writes outside the team workspace.

## Team Memory Files

Keep and standardize:

```text
<team workspace>/memory.json
<team workspace>/last_run.json
<team workspace>/pending.json
```

### `last_run.json`

Should include:

- run ID
- task
- manager summary
- dispatches made
- subagent results
- verification decisions
- files created/modified
- write notes
- unresolved items
- timestamp

### `memory.json`

Should include:

- cumulative team knowledge
- useful findings
- run summaries
- accepted outputs
- manager notes
- subagent notes
- links to artifacts
- important decisions

This should mirror meaningful data from the Runs tab so the manager can reason from team memory without depending on UI state.

### `pending.json`

Should include:

- unresolved blockers
- incomplete subagent work
- follow-up dispatches
- questions awaiting main-agent or user response
- verification failures that need re-run

## Team-Aware `write_note`

Make `write_note` team-aware for manager/subagent sessions.

Behavior:

- Continue writing normal intraday notes if desired.
- Also append a structured note/event to the team's `memory.json`.
- Include:
  - author type: manager or subagent
  - author ID
  - task ID if present
  - note tag
  - content
  - timestamp

This lets team memory capture manager/subagent notes without losing the global notes behavior.

## `[GOAL_COMPLETE]` Main-Agent Review

When a manager outputs `[GOAL_COMPLETE]`, it should trigger a structured handoff to the main Prometheus chat agent.

Completion packet should include:

- team ID and name
- manager completion message
- current task
- current focus
- team goal / purpose
- `team_info.md`
- `memory.json`
- `last_run.json`
- `pending.json`
- recent team chat
- run history / subagent logs
- files created or modified in team workspace
- write notes from manager/subagents
- originating chat session ID
- compact transcript from originating chat session

## Originating Chat Session Review

Prometheus should not verify only against the manager's summary. It should also inspect the chat session that created or initiated the team.

Use `originatingSessionId` from team creation or run start.

Inject a compact transcript window:

```text
[ORIGINATING CHAT SESSION]
originatingSessionId: <id>

Relevant transcript:
- user request that triggered ask_team_coordinator
- surrounding messages before/after
- tool call/result for ask_team_coordinator
- follow-up instructions from the user
- Prometheus's own stated plan/expectations
```

Prometheus compares:

- Original user intent from chat.
- Team purpose and current task.
- Manager's `[GOAL_COMPLETE]` claim.
- Evidence from memory, logs, artifacts, and team chat.

Prometheus then chooses one of:

1. Accept:
   - Tell the user the team completed.
   - Summarize what was done and where outputs are.
   - Log acceptance to team chat.

2. Reject / revise:
   - Send a correction back to the manager.
   - Include specific missing items and required next actions.
   - Re-run manager/team.
   - Log revision request to team chat.

3. Accept with follow-up:
   - Tell the user what completed.
   - Also send the manager back for a correction or next step.
   - Example: "Lead sourcing completed, but outreach drafts were implied by the original chat, so I sent the team back to prepare those."

## Auto-Start Behavior

Change default behavior:

- Team creation should not auto-start after 30 seconds.
- `ask_team_coordinator` should return setup and ask whether to start.
- Starting the team should be explicit:
  - user says yes in main chat,
  - user clicks Run/Start in Teams UI,
  - or Prometheus has an explicit instruction to start after creation.

## Existing Team Migration

For current teams:

1. Create `team_info.md` if missing.
2. If a richer setup file exists, merge it into `team_info.md`.
3. Initialize missing `memory.json`, `last_run.json`, and `pending.json`.
4. Keep existing team chat and run history.
5. Stop relying on `manager.systemPrompt` as passive config; inject it or migrate it into `team_info.md`.
6. Preserve existing subagents and roles. No need to recreate teams.

## Implementation Phases

### Phase 1: Team Creator Cleanup

- Update `ask_team_coordinator` prompt.
- Add memory preflight before team creation.
- Write `team_info.md` in team workspace.
- Create context references from memory/context preflight.
- Stop after setup summary.
- Disable default auto-start after creation.

### Phase 2: Manager Runtime Mode

- Add `team_manager` execution mode.
- Build a small `buildTeamManagerContext(teamId)` prompt.
- Inject `team_info.md`, `memory.json`, `last_run.json`, `pending.json`.
- Inject `team.manager.systemPrompt` or migrate it into `team_info.md`.
- Ensure manager file tools are workspace-sandboxed.
- Add manager-only read access to root memory files.

### Phase 3: Subagent Result Verification

- Track dispatch prompt + task ID + subagent result.
- After dispatch returns, invoke a manager review turn using `[SUBAGENT RESULT TO VERIFY]`.
- Require manager to accept, re-dispatch, or escalate.
- Update `last_run.json` and `memory.json`.

### Phase 4: Team-Aware Notes And Memory

- Make `write_note` append to team memory for manager/subagent sessions.
- Store structured run events in `memory.json`.
- Mirror meaningful Runs tab data into team memory.

### Phase 5: Goal Complete Handoff

- On `[GOAL_COMPLETE]`, build completion packet.
- Include originating chat transcript.
- Send packet to main Prometheus agent.
- Let Prometheus accept, revise, or accept with follow-up.
- Log the decision to team chat and team memory.

### Phase 6: Existing Team Fixup

- Generate `team_info.md` for existing teams.
- Merge current richer setup documents where obvious.
- Initialize missing memory files.
- Keep existing teams/subagents intact.

## Open Design Questions

- Should `team_info.md` be editable from the Teams UI context tab, or should the context tab remain separate reference cards?
- Should managers always see full `team_info.md`, or should very large files be summarized/capped?
- Should `memory_search` be mandatory for every manager run, or only team creation and `[GOAL_COMPLETE]` review?
- Should `[GOAL_COMPLETE]` verification run as the main chat agent directly, or as a dedicated verifier that reports to the main agent?
- Should team-aware `write_note` write to `memory.json` only, or also `last_run.json` when a run is active?

## Desired Final Behavior Example

1. User asks Prometheus to create an Xpose Market lead team.
2. Prometheus calls `ask_team_coordinator`.
3. Meta-coordinator runs memory search, creates agents, creates team, writes `team_info.md`, creates context references, returns setup.
4. Prometheus tells user:
   - team is ready
   - agents created
   - asks whether to initiate now.
5. User starts team.
6. Manager reads `team_info.md`, team memory, and current task.
7. Manager dispatches only relevant subagents.
8. Subagents return results.
9. Manager verifies results, checks files, re-dispatches if needed.
10. Manager updates memory files.
11. Manager outputs `[GOAL_COMPLETE]`.
12. Prometheus receives completion packet plus originating chat transcript.
13. Prometheus compares original intent against actual outputs.
14. Prometheus either:
    - tells user the team completed,
    - sends manager back with corrections,
    - or both.

