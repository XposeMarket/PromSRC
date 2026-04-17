// src/gateway/tools/defs/agent-team-schedule.ts
// Tool definitions for agent management, team collaboration, and scheduling.

export function getAgentTeamScheduleTools(): any[] {
  return [
    // Modular subagent spawning — create custom specialists on the fly
    {
      type: 'function' as const,
      function: {
        name: 'spawn_subagent',
        description:
          'Create and spawn a specialized sub-agent for a specific task. Define the subagent\'s tools, constraints, and instructions dynamically. ' +
          'Perfect for delegating research, analysis, or data extraction to a constrained secondary agent. ' +
          'Set run_now=false to create/ensure an agent without executing it. ' +
          'Subagent configs are persisted and reusable (you can call the same subagent_id again later).',
        parameters: {
          type: 'object',
          required: ['subagent_id'],
          properties: {
            subagent_id: {
              type: 'string',
              description: 'Unique identifier for this subagent (e.g., "news_researcher_v1", "article_analyzer"). Use persistent names so you can call it again.',
            },
            from_role: {
              type: 'string',
              enum: ['planner', 'orchestrator', 'researcher', 'analyst', 'builder', 'operator', 'verifier'],
              description: 'Hydrate this agent from the role registry instead of writing a full create_if_missing. The registry provides a battle-tested base prompt and tool set for this role type. Combine with specialization for domain focus.',
            },
            specialization: {
              type: 'string',
              description: 'Team-specific assignment when using from_role. This becomes the agent\'s concrete team role on top of the generic preset. E.g. "Prospect Researcher: finds local small-business leads for Xpose Market from maps/directories/search."',
            },
            task_prompt: {
              type: 'string',
              description: 'The specific task for this subagent to complete. Required when run_now=true.',
            },
            run_now: {
              type: 'boolean',
              description: 'If false, only create/ensure the subagent exists and do not execute a task (default true).',
            },
            context_data: {
              type: 'object',
              description: 'Optional context to pass to the subagent: snapshots, URLs, previously extracted text, etc.',
            },
            create_if_missing: {
              type: 'object',
              description: 'If subagent does not exist, create it with these specifications. Subagent configs are saved to .prometheus/subagents/ and auto-registered in config.json so they appear in the Agents panel and can be added to teams.',
              properties: {
                name: {
                  type: 'string',
                  description: 'Display name shown in the Agents panel and Teams UI (e.g., "Intel Manager", "Feature Scout")',
                },
                description: {
                  type: 'string',
                  description: 'What this subagent specializes in. Shown in the Agents panel.',
                },
                teamRole: {
                  type: 'string',
                  description: 'Team-specific role title, e.g. "Website/SEO Qualifier" or "Lead Enricher".',
                },
                teamAssignment: {
                  type: 'string',
                  description: 'Concrete team-specific mission for this agent. This is persisted into system_prompt.md alongside the base preset role.',
                },
                allowed_categories: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['browser', 'desktop', 'team_ops', 'source_write', 'integrations', 'connectors'],
                  },
                  description: 'Tool categories to pre-activate for this subagent. Core tools (file ops, web search/fetch, run_command, send_telegram, memory) are ALWAYS available regardless. request_tool_category is always available as a last-resort escape hatch. Use this instead of listing individual tools.',
                },
                allowed_tools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Legacy: individual tool names. Prefer allowed_categories instead.',
                },
                forbidden_tools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Explicit tool blacklist (e.g., ["run_command", "create_file"])',
                },
                system_instructions: {
                  type: 'string',
                  description: 'Full system prompt / instructions for this agent. Written to system_prompt.md and used every time the agent runs.',
                },
                heartbeat_instructions: {
                  type: 'string',
                  description: 'Written to HEARTBEAT.md. Used when this agent is assigned to a cron schedule via schedule_job(subagent_id). Include: what to check, what to do, when to stop.',
                },
                constraints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Hard rules the subagent MUST follow',
                },
                success_criteria: {
                  type: 'string',
                  description: 'When to consider the task complete',
                },
                max_steps: {
                  type: 'number',
                  description: 'Maximum tool calls before stopping (default 20)',
                },
                timeout_ms: {
                  type: 'number',
                  description: 'Max milliseconds to wait (default 300000 = 5 min)',
                },
                model: {
                  type: 'string',
                  description: 'Optional model override for this subagent',
                },
                is_team_manager: {
                  type: 'boolean',
                  description: 'Set true if this agent is a team manager (orchestrator). Marks isTeamManager=true in config.json so it appears at the top of its team in the Agents panel.',
                },
              },
              required: ['description', 'system_instructions', 'constraints', 'success_criteria'],
            },
          },
        },
      },
    },
    // ── Agent Tools ───────────────────────────────────────────────────────────
    {
      type: 'function' as const,
      function: {
        name: 'agent_list',
        description: 'List all configured sub-agents in this workspace. Always call this first before spawning or referencing any agent — it returns their IDs, descriptions, and capabilities.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'agent_info',
        description: 'Get full details about a specific configured agent by ID — its instructions, tool access, constraints, and schedule.',
        parameters: {
          type: 'object',
          required: ['agent_id'],
          properties: {
            agent_id: { type: 'string', description: 'The agent ID to look up (get IDs from agent_list first)' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'delete_agent',
        description:
          'Permanently delete a subagent from the system. Removes the agent from config, cleans up its workspace directory, ' +
          'removes it from any managed teams, and deletes its scheduled jobs. ' +
          'Cannot delete the default main agent. Use agent_list() first to confirm the agent ID.',
        parameters: {
          type: 'object',
          required: ['agent_id', 'confirm'],
          properties: {
            agent_id: { type: 'string', description: 'ID of the agent to delete (from agent_list)' },
            confirm: { type: 'boolean', description: 'Must be true to confirm deletion — prevents accidental removal' },
          },
        },
      },
    },
    // ── Agent-to-Agent Messaging Tools ─────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'talk_to_subagent',
        description: 'Send a direct message to a specific subagent on your team. The message is queued and delivered to that agent. If the agent is paused waiting for manager input, this resumes it. Use this to give instructions, share findings, pass data, or redirect an agent mid-pipeline. Only works inside team dispatches.',
        parameters: {
          type: 'object',
          required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'ID of the subagent to message (e.g. "post_writer_v1")' },
            message: { type: 'string', description: 'Message to deliver to the agent. Include all context they need.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'talk_to_manager',
        description: 'Send a message to your team manager. Use this to report blockers, share findings, request a new task, or ask for clarification. Set wait_for_reply=true when you need the task paused until the manager answers. Only works inside team dispatches.',
        parameters: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', description: 'Message for the manager. Be specific: what you did, what you found, what you need.' },
            wait_for_reply: { type: 'boolean', description: 'If true, pause this task after sending the message so the manager can answer and resume you.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'talk_to_teammate',
        description:
          'Send a message to a teammate agent or the whole team. ' +
          'Use to coordinate, give feedback, report blockers, share findings, or discuss approach. ' +
          'Messages are delivered to the recipient\'s next turn context.',
        parameters: {
          type: 'object', required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'Target agent ID, or "all" to broadcast to whole team, or "manager" for the team manager.' },
            message: { type: 'string', description: 'Your message content.' },
            type: { type: 'string', enum: ['chat', 'feedback', 'blocker', 'plan', 'result'], description: 'Message type. Default: chat.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_my_status',
        description:
          'Update your status on the team\'s shared status board. ' +
          'Teammates and the manager can see your status in real-time. ' +
          'Call when starting a task, completing work, or hitting a blocker.',
        parameters: {
          type: 'object', required: ['phase'],
          properties: {
            phase: { type: 'string', enum: ['planning', 'executing', 'blocked', 'done'], description: 'Your current phase.' },
            current_task: { type: 'string', description: 'What you\'re working on right now.' },
            blocked_reason: { type: 'string', description: 'Why you\'re blocked (if phase=blocked).' },
            result: { type: 'string', description: 'Summary of what you accomplished (if phase=done).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_team_goal',
        description:
          'Propose a new team goal or update an existing one. ' +
          'Any team member can suggest goal changes. The manager reviews during the review phase.',
        parameters: {
          type: 'object', required: ['description', 'reason'],
          properties: {
            goal_id: { type: 'string', description: 'Existing goal ID to update. Omit to create a new goal.' },
            description: { type: 'string', description: 'Goal description.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Goal priority. Default: medium.' },
            status: { type: 'string', enum: ['active', 'completed', 'blocked', 'dropped'], description: 'Goal status. Default: active.' },
            reason: { type: 'string', description: 'Why this goal is being created or changed.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'team_manage',
        description: 'Manage managed teams: list teams, create/start teams, trigger manager review, dispatch one-off tasks.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: list, create, start, update, delete, trigger_review, dispatch, pause, resume' },
            team_id: { type: 'string', description: 'Required for start, update, delete, trigger_review, and dispatch' },
            name: { type: 'string', description: 'Team name for create' },
            description: { type: 'string', description: 'Team description for create' },
            emoji: { type: 'string', description: 'Optional team emoji' },
            purpose: { type: 'string', description: 'Static team purpose — why this team exists permanently (e.g. "Monitor the codebase for security issues"). Each run, the coordinator reads memory files and derives a fresh task from this purpose. Preferred over team_context for new teams.' },
            team_context: { type: 'string', description: 'Legacy: overall team goal/context. Use purpose instead for new teams.' },
            manager_system_prompt: { type: 'string', description: 'Optional manager system prompt override' },
            manager_model: { type: 'string', description: 'Optional manager model override, e.g. openai/gpt-4o' },
            review_trigger: { type: 'string', description: 'after_each_run, after_all_runs, daily, manual' },
            subagent_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Existing subagent IDs to include in the team',
            },
            kickoff_initial_review: { type: 'boolean', description: 'If true, schedule an initial manager review shortly after creation. Default is false; leave unset when only creating a ready/not-started team.' },
            kickoff_after_seconds: { type: 'number', description: 'Delay before initial review (default 30s, range 5-300).' },
            agent_id: { type: 'string', description: 'For dispatch: target team member agent ID' },
            task: { type: 'string', description: 'For start: kickoff task for manager coordination. For dispatch: one-off task to execute now' },
            context: { type: 'string', description: 'For dispatch: optional extra context' },
            confirm: { type: 'boolean', description: 'For delete: must be true to confirm deletion' },
            delete_agents: { type: 'boolean', description: 'For delete: if true, also delete all member agents from config (default false)' },
            add_subagent_ids: { type: 'array', items: { type: 'string' }, description: 'For update: agent IDs to add to the team' },
            remove_subagent_ids: { type: 'array', items: { type: 'string' }, description: 'For update: agent IDs to remove from the team' },
            originating_session_id: { type: 'string', description: 'Internal: the main chat session that triggered team creation via ask_team_coordinator. Stored on the team so results route back to that session.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_heartbeat',
        description: 'Update the main/default heartbeat configuration or HEARTBEAT.md instructions. Subagent heartbeats are disabled; use schedule_job with subagent_id for recurring subagent work.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            agent_id: { type: 'string', description: 'Which heartbeat to configure. Defaults to "main". Only "main" and "default" are supported.' },
            enabled: { type: 'boolean', description: 'Enable or disable the main/default heartbeat timer.' },
            interval_minutes: { type: 'number', description: 'How often the main/default heartbeat fires, in minutes. Min 1, max 1440. Default 30.' },
            model: { type: 'string', description: 'Optional model override for main/default heartbeat runs. Leave blank to use the global default.' },
            instructions: { type: 'string', description: 'Full replacement content for the main/default HEARTBEAT.md file. For subagents, create a schedule_job with subagent_id instead.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job',
        description: 'Manage scheduled jobs (list/create/update/pause/resume/delete/run_now). Use this for recurring or time-based automation, including any subagent cron by setting subagent_id.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: list, create, update, pause, resume, delete, run_now' },
            job_id: { type: 'string', description: 'Required for update/pause/resume/delete/run_now' },
            name: { type: 'string', description: 'Job name (create/update)' },
            instruction_prompt: { type: 'string', description: 'REQUIRED for create/update. This is the ONLY instruction the agent receives when the job fires — it must be fully self-contained. Include: who the agent is, the exact step-by-step actions to take (with tool names where relevant), any constraints, and what success looks like. Do NOT write a label or summary — write executable instructions as if briefing a fresh agent with zero context.' },
            schedule: {
              type: 'object',
              properties: {
                kind: { type: 'string', description: 'recurring or one_shot' },
                cron: { type: 'string', description: 'Cron expression for recurring jobs' },
                run_at: { type: 'string', description: 'ISO timestamp for one-shot jobs' },
              },
            },
            timezone: { type: 'string', description: 'IANA timezone (e.g. America/New_York)' },
            delivery: {
              type: 'object',
              properties: {
                channel: { type: 'string', description: 'web, telegram, discord, whatsapp' },
                session_target: { type: 'string', description: 'main or isolated' },
              },
            },
            model_override: { type: 'string', description: 'Optional model override for this scheduled job' },
            subagent_id: { type: 'string', description: 'Optional: ID of a subagent definition in workspace/.prometheus/subagents/ to use for this job. When set, the subagent system instructions and constraints are automatically injected at runtime.' },
            confirm: { type: 'boolean', description: 'Must be true for create/update/delete actions' },
            limit: { type: 'number', description: 'Optional max jobs returned for list' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'parse_schedule_pattern',
        description: 'Parse natural language schedule patterns to cron expressions. Use before creating schedules to convert user language like "daily at 3:13pm" to proper cron syntax.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Natural language pattern, e.g. "daily at 3:13pm", "every weekday at 9am", "weekly on monday"' },
            timezone: { type: 'string', description: 'Optional IANA timezone (e.g. America/New_York). Defaults to UTC.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_control',
        description: 'Query and control background tasks. Use this instead of reading files to discover task status.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: list, latest, get, resume, rerun, pause, cancel, delete' },
            task_id: { type: 'string', description: 'Task ID (required for get/pause/cancel/delete; optional for resume/rerun)' },
            status: { type: 'string', description: 'Optional filter: queued|running|paused|stalled|needs_assistance|awaiting_user_input|failed|complete|waiting_subagent' },
            include_all_sessions: { type: 'boolean', description: 'If true, list across all sessions/channels; default false (scoped)' },
            limit: { type: 'number', description: 'Max tasks to return (default 20, max 100)' },
            note: { type: 'string', description: 'Optional operator note to append when resuming/rerunning' },
            confirm: { type: 'boolean', description: 'Required true for destructive actions cancel/delete' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_spawn',
        description:
          'Spawn a one-time ephemeral background agent (full tool-capable LLM call) to run a task in parallel while you continue your primary work. ' +
          'Result is automatically merged into your final response — NEVER call background_join manually.\n\n' +
          'PREFER FOR SIDECAR WORK: independent memory writes, codebase scans, web research, and other data gathering that can run while the main flow continues.\n\n' +
          'USE WHEN all 3 conditions are true:\n' +
          '  1. The work is independent of your primary tool sequence (no shared dependencies)\n' +
          '  2. It can start right now with everything it needs (all context is in the prompt)\n' +
          '  3. You do NOT need its result before your immediate next action\n\n' +
          'DO NOT USE WHEN: the result is required to choose your next step, or this IS your primary blocking task.\n\n' +
          'PROMPT MUST BE FULLY SELF-CONTAINED — the bg agent has no session history. Include file paths, ' +
          'exact content, specific tool calls, and all parameters. Never say "what we discussed" or "the current task."',
        parameters: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Fully self-contained instructions. Include all context, file paths, and exact parameters — the agent has no session history.' },
            join_policy: {
              type: 'string',
              enum: ['wait_all', 'wait_until_timeout', 'best_effort_merge'],
              description: 'Auto-merge policy at turn-end. Default: wait_until_timeout (15s). Use wait_all for multi-step bg agent tasks.',
            },
            timeout_ms: { type: 'number', description: 'Auto-merge wait window ms. Default 15000. Set higher for multi-step bg agent tasks.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for tracking/grouping.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_status',
        description: 'Check whether a background agent is still running, completed, or failed. Only use this if you explicitly need to poll mid-turn — the system auto-merges results at turn end.',
        parameters: {
          type: 'object',
          required: ['background_id'],
          properties: {
            background_id: { type: 'string', description: 'ID returned by background_spawn.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_progress',
        description: 'Alias of background_status. Check running/completed/failed state of a background agent.',
        parameters: {
          type: 'object',
          required: ['background_id'],
          properties: {
            background_id: { type: 'string', description: 'ID returned by background_spawn.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_join',
        description:
          'SYSTEM USE ONLY — do not call this manually. The finalization gate runs background_join automatically at the end of every turn to merge completed background agents into the response. ' +
          'Calling it yourself is redundant and may cause double-merge.',
        parameters: {
          type: 'object',
          required: ['background_id'],
          properties: {
            background_id: { type: 'string', description: 'ID returned by background_spawn.' },
            join_policy: {
              type: 'string',
              enum: ['wait_all', 'wait_until_timeout', 'best_effort_merge'],
              description: 'Override join policy.',
            },
            timeout_ms: { type: 'number', description: 'Optional wait timeout.' },
          },
        },
      },
    },
    // ── Background Agent Plan Tools (bg_agent execution mode only) ──────────
    // Isolated plan tracking for background agents. Never touches the main plan
    // panel or background task records. Lives in memory, keyed by bg session ID.
    {
      type: 'function',
      function: {
        name: 'bg_plan_declare',
        description:
          'Declare a step-by-step plan for this background agent\'s multi-step work. ' +
          'Call this at the start if your task has 2 or more meaningful phases. ' +
          'Completely isolated from the main agent\'s plan panel — safe to use without interference. ' +
          'After declaring, execute Step 1 immediately. Call bg_plan_advance when each step completes.',
        parameters: {
          type: 'object',
          required: ['steps'],
          properties: {
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Step labels in order (2–8 steps). Each is a short phase description.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'bg_plan_advance',
        description:
          'Mark the current step complete and advance to the next one. ' +
          'Call this after finishing each step\'s tool calls. Returns the next step to execute, ' +
          'or confirms all steps are done when the final step is advanced.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            note: { type: 'string', description: 'Optional short note about what was completed in this step.' },
          },
        },
      },
    },
    // ── Progress Plan Tool ────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'declare_plan',
        description: 'Declare a step-by-step plan before executing complex multi-phase work. Call this FIRST only when the task has meaningful phases (2–6) such as branching decisions, cross-system coordination, or extended execution. Do NOT use for quick linear actions even if they require multiple tools (e.g., screenshot capture/send, simple open-click-type flows, single lookup+reply). browser_* and desktop_* tools do NOT auto-advance the plan — many tool calls can belong to one phase. Call complete_plan_step when a phase is finished. File/shell/memory tools still advance the plan per successful action.',
        parameters: {
          type: 'object',
          required: ['steps'],
          properties: {
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ordered list of 2–6 high-level phases, e.g. ["Capture screen and focus app", "Scroll and read content", "Summarize for user"]',
            },
            task_summary: {
              type: 'string',
              description: 'One-line summary of the overall task, shown as the plan header',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_plan_step',
        description:
          'Mark the current declare_plan phase finished and move to the next plan line. Use after you finish a phase (e.g. desktop focus + screenshots done) before starting the next. Not needed for browser/desktop-only work until the phase is actually complete.',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'Optional one-line reason (e.g. "Claude window located and verified")' },
          },
        },
      },
    },
    // ── Step Completion Tool (background tasks only) ──────────────────────
    {
      type: 'function' as const,
      function: {
        name: 'step_complete',
        description:
          'Mark the current background task step as complete and advance to the next step. ' +
          'Call this after you finish ALL tool calls for a step. ' +
          'Only valid during autonomous background task execution — do NOT call this in interactive chat.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            note: {
              type: 'string',
              description: 'Optional one-line summary of what was accomplished in this step.',
            },
            step_index: {
              type: 'number',
              description: 'Optional: explicit 0-based step index to complete. Defaults to current step.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dispatch_to_agent',
        description: 'Route a task or message to a specific named agent by ID. Creates a background task for that agent and returns immediately. Use agent_list() first to see available agents.',
        parameters: {
          type: 'object',
          required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'The ID of the agent to dispatch to (from agent_list)' },
            message: { type: 'string', description: 'The task/message to send to the agent. Be specific and self-contained.' },
            context: { type: 'string', description: 'Optional additional context for the agent' },
          },
        },
      },
    },
    // ── run_task_now: one-off background task with silent verification ─────────
    {
      type: 'function',
      function: {
        name: 'run_task_now',
        description:
          'Run a task immediately in the background — silently, with no logs or tool calls shown. ' +
          'Both the task execution and a verification pass run fully in the background while you continue chatting. ' +
          'Once the task is verified complete, a single final response is delivered directly into this chat session. ' +
          'Use this for work that may take a while and that you want to confirm was done correctly before reporting back. ' +
          'Unlike background_spawn (ephemeral, 15s cap), this is fully persisted, survives restart, and visible in the Tasks panel.',
        parameters: {
          type: 'object',
          required: ['title', 'prompt'],
          properties: {
            title: {
              type: 'string',
              description: 'Short display name shown in the Tasks panel (e.g. "Research competitor pricing")',
            },
            prompt: {
              type: 'string',
              description: 'Fully self-contained instructions for the task agent. Include all context, file paths, and specific steps — the agent has no session history.',
            },
            subagent_id: {
              type: 'string',
              description: 'Optional: ID of a configured subagent to inherit system instructions from. If provided, the subagent\'s system_prompt.md is injected as context for the task.',
            },
            timeout_ms: {
              type: 'number',
              description: 'Optional max milliseconds for the task phase (default 300000 = 5 min). Verification runs separately after task completes.',
            },
          },
        },
      },
    },
  ];
}
