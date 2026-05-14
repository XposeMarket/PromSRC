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
              description: 'Concrete standalone specialization when using from_role. If the agent is later added to a team, this can become its team role. E.g. "Prospect Researcher: finds local small-business leads for Xpose Market from maps/directories/search."',
            },
            personality_style: {
              type: 'string',
              description: 'Optional personality preset for newly created agents: steady, spark, austere, mentor, operator, critic, creative. Leave blank to let Prometheus choose from role and assignment.',
            },
            name_style: {
              type: 'string',
              description: 'Optional naming hint for newly created agents. Use natural, grounded human-like names; avoid gimmicks.',
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
              description: 'If subagent does not exist, create it with these specifications. Standalone subagent configs are saved globally; team-assigned identity files live under workspace/teams/<teamId>/subagents/ and appear in the Agents panel.',
              properties: {
                name: {
                  type: 'string',
                  description: 'Optional display name shown in the Agents panel and Teams UI. If omitted, Prometheus generates a tasteful human name for the agent.',
                },
                identity: {
                  type: 'object',
                  description: 'Optional explicit name/personality identity block. If omitted, Prometheus generates one from role, specialization, and assignment.',
                },
                personality_style: {
                  type: 'string',
                  description: 'Optional personality preset: steady, spark, austere, mentor, operator, critic, creative.',
                },
                name_style: {
                  type: 'string',
                  description: 'Optional naming hint. Keep names grounded and non-gimmicky.',
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
                  description: 'Optional team-specific mission. Leave blank for standalone one-off subagents; use system_instructions/description for normal standalone identity.',
                },
                executionWorkspace: {
                  type: 'string',
                  description: 'Optional default working directory for this agent. Relative paths resolve inside the main workspace. Must be inside allowedWorkPaths.',
                },
                execution_workspace: {
                  type: 'string',
                  description: 'Alias for executionWorkspace.',
                },
                allowedWorkPaths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Workspace roots this agent may read/write/run commands in. Defaults to the main workspace. Relative paths resolve inside the main workspace; absolute paths are allowed when intentionally granted.',
                },
                allowed_work_paths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Alias for allowedWorkPaths.',
                },
                allowed_tools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Legacy metadata only. Subagents receive the full standard tool surface at runtime.',
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
                  description: 'Written to HEARTBEAT.md. Used by this agent heartbeat when enabled. Include: what to check, what to do, when to stop.',
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
        name: 'agent_update',
        description:
          'Directly update a configured spawn_subagent profile without asking the agent to edit files itself. ' +
              'Use agent_list first to get the exact agent_id. Supports renaming, description/instruction updates, model/max-step settings, and heartbeat instructions. ' +
          'This keeps config.json, system_prompt.md, and the Agents UI in sync for dynamic subagents.',
        parameters: {
          type: 'object',
          required: ['agent_id'],
          properties: {
            agent_id: { type: 'string', description: 'The dynamic subagent ID to update (get IDs from agent_list first)' },
            name: { type: 'string', description: 'New display name shown in Agents and Teams UI' },
            description: { type: 'string', description: 'New short description / specialty summary' },
            system_instructions: { type: 'string', description: 'Full replacement instructions for system_prompt.md' },
            heartbeat_instructions: { type: 'string', description: 'Full replacement content for HEARTBEAT.md' },
            executionWorkspace: { type: 'string', description: 'Default working directory for this agent. Must be inside allowedWorkPaths.' },
            execution_workspace: { type: 'string', description: 'Alias for executionWorkspace.' },
            allowedWorkPaths: { type: 'array', items: { type: 'string' }, description: 'Full replacement allowed work roots. Defaults include the main workspace; relative paths resolve inside it.' },
            allowed_work_paths: { type: 'array', items: { type: 'string' }, description: 'Alias for allowedWorkPaths.' },
            constraints: { type: 'array', items: { type: 'string' }, description: 'Full replacement constraints list' },
            success_criteria: { type: 'string', description: 'Full replacement success criteria' },
            allowed_tools: { type: 'array', items: { type: 'string' }, description: 'Legacy full replacement individual tool names' },
            forbidden_tools: { type: 'array', items: { type: 'string' }, description: 'Full replacement explicit blacklist' },
            model: { type: 'string', description: 'Optional model override; pass an empty string to clear' },
            max_steps: { type: 'number', description: 'Maximum tool calls before stopping' },
            timeout_ms: { type: 'number', description: 'Max milliseconds to wait' },
            teamRole: { type: 'string', description: 'Team-specific role title' },
            teamAssignment: { type: 'string', description: 'Team-specific assignment / mission' },
            identity: { type: 'object', description: 'Full or partial replacement identity/personality block' },
            personality_style: { type: 'string', description: 'Regenerate personality from preset: steady, spark, austere, mentor, operator, critic, creative' },
            name_style: { type: 'string', description: 'Naming hint used when regenerating identity' },
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
        name: 'message_subagent',
        description:
          'Send a normal direct message to a standalone one-off subagent in the background and return a task id immediately. ' +
          'Use this when the user wants the main chat agent to hand work or a question to an existing standalone subagent as a peer while main chat continues. ' +
          'The subagent working conversation and final result stay in the subagent task panel, not the main chat. This is not team dispatch and only works for subagents that are not assigned to a managed team. Call agent_list() first if you are unsure of the ID.',
        parameters: {
          type: 'object',
          required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'ID of the standalone subagent to message.' },
            message: { type: 'string', description: 'Plain-language message to send to the subagent in the background. Include the task or question.' },
            context: { type: 'string', description: 'Optional additional context from the main chat.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'talk_to_manager',
        description: 'Send a message to your team manager. The message is also posted as a visible team chat bubble so the room stays legible. Use this to report blockers, share findings, request a new task, or ask for clarification. Set wait_for_reply=true when you need the task paused until the manager answers. Only works inside team dispatches.',
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
        name: 'request_context',
        description:
          'Ask the team manager for missing context needed to continue. ' +
          'This posts a manager-visible blocker/context request, updates the shared room, and can pause your task until the manager replies. Only works inside team subagent sessions.',
        parameters: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string', description: 'The specific context, decision, credential, file, or clarification you need.' },
            wait_for_reply: { type: 'boolean', description: 'If true, pause after asking. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_manager_help',
        description:
          'Escalate a blocker to the team manager and ask for help. ' +
          'Use when you are stuck, need a decision, or need another teammate assigned. Only works inside team subagent sessions.',
        parameters: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', description: 'What is blocked, what you already tried, and what help you need.' },
            wait_for_reply: { type: 'boolean', description: 'If true, pause after escalating. Default true.' },
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
          'Messages are delivered to the recipient\'s next turn context and posted as visible team chat bubbles.',
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
        name: 'share_artifact',
        description:
          'Share an output, file, data object, or important finding with the whole team. ' +
          'Artifacts are added to shared team state so the manager and teammates can see them in future room snapshots. Only works inside team subagent sessions.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Short artifact name, e.g. "lead-list.csv" or "pricing-analysis".' },
            type: { type: 'string', description: 'Artifact kind, e.g. file, note, data, report, image, code.' },
            description: { type: 'string', description: 'What this artifact contains and why it matters.' },
            content: { type: 'string', description: 'Optional inline content or summary.' },
            path: { type: 'string', description: 'Optional path in the team workspace.' },
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
            phase: {
              type: 'string',
              enum: ['idle', 'planning', 'ready', 'waiting_for_context', 'executing', 'running', 'blocked', 'reviewing', 'done'],
              description: 'Your current team-room state. Legacy values like executing/done are still accepted.',
            },
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
	        description: 'Update heartbeat configuration or HEARTBEAT.md instructions for main/default or any configured subagent. Managers can use this to adjust a team subagent heartbeat.',
	        parameters: {
	          type: 'object',
	          required: [],
	          properties: {
	            agent_id: { type: 'string', description: 'Which heartbeat to configure. Defaults to "main". Use a configured subagent ID to update that agent.' },
	            enabled: { type: 'boolean', description: 'Enable or disable this agent heartbeat timer.' },
	            interval_minutes: { type: 'number', description: 'How often the main/default heartbeat fires, in minutes. Min 1, max 1440. Default 30.' },
	            model: { type: 'string', description: 'Optional model override for heartbeat runs. Leave blank to use the global/default agent model.' },
	            instructions: { type: 'string', description: 'Full replacement content for this agent HEARTBEAT.md file.' },
	          },
	        },
	      },
    },
	    {
	      type: 'function',
	      function: {
	        name: 'timer',
	        description: 'Create, list, update/reschedule, or cancel one-off main-chat timers. A timer fires later as a regular user-like message in its original chat session. Use for requests like "check this in 5 minutes", "remind/follow up in 30 minutes", "show my timers", "change that timer prompt", "move the timer to 8pm", or "cancel that timer". Main chat only; do not use for recurring automation.',
	        parameters: {
	          type: 'object',
	          required: ['action'],
	          properties: {
	            action: { type: 'string', description: 'One of: create, list, update, modify, reschedule, cancel' },
	            instruction: { type: 'string', description: 'Required for create. For update/modify, replacement task Prometheus should perform when the timer fires.' },
	            prompt: { type: 'string', description: 'Alias for instruction when creating or updating a timer.' },
	            delay_seconds: { type: 'number', description: 'For create/update/reschedule: relative delay in seconds from now. Minimum 5 seconds.' },
	            due_at: { type: 'string', description: 'For create/update/reschedule: ISO timestamp when the timer should fire. Use instead of delay_seconds when the user gives a specific date/time.' },
	            label: { type: 'string', description: 'Optional short label for the timer. For update, replaces the existing label.' },
	            timer_id: { type: 'string', description: 'Required for update/modify/reschedule/cancel.' },
	            all_sessions: { type: 'boolean', description: 'For list/update/cancel: if true, view or manage timers across all main-chat sessions instead of only this chat.' },
	            session_id: { type: 'string', description: 'For list/update/cancel: manage timers for a specific chat session. Defaults to the current session unless all_sessions=true.' },
	            include_done: { type: 'boolean', description: 'For list: include completed/cancelled timers.' },
	          },
	        },
	      },
	    },
    {
      type: 'function',
      function: {
        name: 'internal_watch',
        description:
          'Create, list, or cancel bounded internal watches that ping/resume this chat when an internal condition changes. ' +
          'Use after triggering background work, request_team_member_turn(background=true), dispatch_team_agent(background=true), schedule_job(run_now), collectors, build/restart checks, or file-producing jobs so Prometheus does not have to manually poll. ' +
          'Supported targets: file, task, scheduled_job, event_queue. Watches require a TTL, persist across gateway restart, and default to firing once.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: create, list, cancel' },
            id: { type: 'string', description: 'Optional stable watch id. Existing active watch with same id is reused.' },
            label: { type: 'string', description: 'Short operator-readable label.' },
            ttl_ms: { type: 'number', description: 'Required-ish for create. Defaults to 20 minutes, min 5s, max 24h.' },
            target: {
              type: 'object',
              description: 'Typed target config. file requires path; task requires task_id/taskId; scheduled_job requires job_id/jobId; event_queue watches workspace/events/pending.json.',
              properties: {
                type: { type: 'string', enum: ['file', 'task', 'scheduled_job', 'event_queue'] },
                path: { type: 'string', description: 'Workspace-relative file path for file watches.' },
                task_id: { type: 'string', description: 'Task id for task watches.' },
                job_id: { type: 'string', description: 'Scheduled job id for scheduled_job watches.' },
                match: { type: 'object', description: 'For event_queue: key/value fields that must match an event.' },
              },
            },
            condition: {
              type: 'object',
              description: 'Condition options. File modes: exists, appears, changes, appears_or_changes. Scheduled job modes: latest_result, ran, terminal. Task defaults to terminal statuses.',
              properties: {
                mode: { type: 'string' },
                terminalStatuses: { type: 'array', items: { type: 'string' } },
                requireText: { type: 'string', description: 'Optional text that must appear in file/result/event payload.' },
                absentText: { type: 'string', description: 'Optional text that must not appear in file/result/event payload.' },
                match: { type: 'object', description: 'Event queue key/value match config.' },
              },
            },
            on_match: {
              type: 'string',
              description: 'Instruction to run in the originating chat when the watch matches. Supports {{watch_id}}, {{watch_label}}, {{path}}, {{task_id}}, {{job_id}}, {{status}}, {{result}}, {{observation_json}}.',
            },
            on_timeout: {
              type: 'string',
              description: 'Optional instruction to run in the originating chat if TTL expires before matching.',
            },
            max_firings: { type: 'number', description: 'Default 1. Keep 1 unless explicitly watching multiple changes.' },
            watch_id: { type: 'string', description: 'Required for cancel. Alias of id.' },
            include_done: { type: 'boolean', description: 'For list: include matched/timed_out/cancelled/failed watches.' },
          },
        },
      },
    },
	    {
	      type: 'function',
	      function: {
	        name: 'schedule_job',
	        description: 'Manage scheduled jobs (list/create/update/pause/resume/delete/run_now). Use team_id to schedule a managed team run where the manager wakes first and dispatches members from the team goal. Otherwise recurring/time-based jobs are schedule-owner-subagent backed by default; if subagent_id is omitted, the scheduler creates/assigns a dedicated owner subagent. Do not use session_target=main to represent ownership.',
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
                session_target: { type: 'string', description: 'Legacy compatibility only. Scheduled jobs run through an isolated schedule-owner subagent even if main is requested.' },
              },
            },
            model_override: { type: 'string', description: 'Optional model override for this scheduled job' },
	            subagent_id: { type: 'string', description: 'Optional: ID of a configured subagent to use as the schedule owner. If omitted, a dedicated owner subagent is created and assigned automatically.' },
            team_id: { type: 'string', description: 'Optional: managed team ID. When set, the scheduled run wakes that team manager first; the manager derives the run from team goal/memory and dispatches agents accordingly.' },
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
        name: 'schedule_job_history',
        description: 'Get recent execution history for a scheduled job, including status, duration, errors, output summary, task/subagent linkage, retry count, and blocker reason when detectable.',
        parameters: {
          type: 'object',
          required: ['job_id'],
          properties: {
            job_id: { type: 'string', description: 'Scheduled job id or exact job name.' },
            limit: { type: 'number', description: 'Number of recent run records to return. Default 10.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job_detail',
        description: 'Open a scheduled job detail snapshot: config, prompt, schedule, latest result, recent errors, linked tasks, internal watches, event queue entries, output checks, and schedule memory.',
        parameters: {
          type: 'object',
          required: ['job_id'],
          properties: {
            job_id: { type: 'string', description: 'Scheduled job id or exact job name.' },
            limit: { type: 'number', description: 'Recent run count to include. Default 10.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job_log_search',
        description: 'Search scheduled-job run logs by job, text, status, output content, error text, blocker text, or date range.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string', description: 'Text to search for in run output, errors, job config, or blocker fields.' },
            job_id: { type: 'string', description: 'Optional scheduled job id or exact job name to restrict the search.' },
            status: { type: 'string', description: 'Optional exact run status filter, e.g. success, error, complete, failed, running.' },
            date_from: { type: 'string', description: 'Optional ISO date/time lower bound.' },
            date_to: { type: 'string', description: 'Optional ISO date/time upper bound.' },
            limit: { type: 'number', description: 'Max matches to return. Default 25.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job_patch',
        description: 'Safely preview or apply a targeted scheduled-job edit. Use action=preview first to see field-level diffs; apply requires confirm=true.',
        parameters: {
          type: 'object',
          required: ['job_id'],
          properties: {
            action: { type: 'string', description: 'preview or apply. Default preview.' },
            job_id: { type: 'string', description: 'Scheduled job id or exact job name.' },
            name: { type: 'string', description: 'New job name.' },
            instruction_prompt: { type: 'string', description: 'Full replacement job prompt/instructions.' },
            schedule: {
              type: 'object',
              description: 'Schedule patch: {kind:"recurring", cron:"0 9 * * *"} or {kind:"one_shot", run_at:"..."}',
            },
            timezone: { type: 'string', description: 'IANA timezone such as America/New_York.' },
            delivery: { type: 'object', description: 'Delivery patch. Currently supports channel:web. session_target is legacy and is coerced to isolated schedule-owner execution.' },
            model_override: { type: 'string', description: 'Optional model override; empty string clears.' },
            enabled: { type: 'boolean', description: 'Enable or pause the job.' },
            expected_outputs: {
              type: 'array',
              description: 'Expected output specs: strings or {path, requiredText, absentText} objects.',
              items: {
                anyOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      requiredText: { type: 'string' },
                      absentText: { type: 'string' },
                    },
                    required: ['path'],
                  },
                ],
              },
            },
            confirm: { type: 'boolean', description: 'Required true for action=apply after previewing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job_outputs',
        description: 'Manage and check expected outputs for a scheduled job. Alerts when expected files are missing, stale, or fail required/absent text checks.',
        parameters: {
          type: 'object',
          required: ['job_id', 'action'],
          properties: {
            action: { type: 'string', description: 'get, set, or check.' },
            job_id: { type: 'string', description: 'Scheduled job id or exact job name.' },
            expected_outputs: {
              type: 'array',
              description: 'For set: strings or {path, requiredText, absentText} objects. Paths must be workspace-relative.',
              items: {
                anyOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      requiredText: { type: 'string' },
                      absentText: { type: 'string' },
                    },
                    required: ['path'],
                  },
                ],
              },
            },
            confirm: { type: 'boolean', description: 'Required true for set.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_job_stuck_control',
        description: 'Operator controls for stuck scheduled jobs: clear blocked/error state, mark handled, cancel retry backoff, or reset and rerun clean. Mutating actions require confirm=true.',
        parameters: {
          type: 'object',
          required: ['job_id', 'action'],
          properties: {
            action: { type: 'string', description: 'clear_blocked, mark_handled, cancel_retry_loop, or rerun_clean.' },
            job_id: { type: 'string', description: 'Scheduled job id or exact job name.' },
            note: { type: 'string', description: 'Optional operator note, especially for mark_handled.' },
            confirm: { type: 'boolean', description: 'Required true for all actions.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'automation_dashboard',
        description: 'Return one unified automation snapshot: scheduled jobs with health, recent tasks, internal watches, pending event queue, and aggregate counts.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            limit: { type: 'number', description: 'Max jobs/tasks/watches/events to return. Default 25.' },
            include_done: { type: 'boolean', description: 'Include completed/cancelled internal watches, not just active watches.' },
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
              description: 'Auto-merge policy at turn-end. Default: wait_all.',
            },
            timeout_ms: { type: 'number', description: 'Optional wait cap used by timeout-based policies. Default 120000.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for tracking/grouping.' },
            model_override: { type: 'string', description: 'Optional explicit model override for this background run.' },
            provider_override: { type: 'string', description: 'Optional explicit provider override for this background run.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_wait',
        description:
          'Pause this foreground turn briefly while background agents work. Use after background_spawn when you want to give workers time before continuing reasoning, e.g. wait_ms/timeout_ms=30000. ' +
          'If background_id/background_ids are omitted, waits on active background agents spawned by this chat session. This does not merge results; the finalization gate still merges all same-turn background results before the final reply.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            background_id: { type: 'string', description: 'Optional single background agent ID returned by background_spawn.' },
            background_ids: { type: 'array', items: { type: 'string' }, description: 'Optional list of background agent IDs returned by background_spawn.' },
            wait_ms: { type: 'number', description: 'How long to wait in milliseconds. Example: 30000.' },
            timeout_ms: { type: 'number', description: 'Alias for wait_ms.' },
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
        legacy_description:
          'Run a task immediately in the background — silently, with no logs or tool calls shown. ' +
          'Continue executing the task here in this same conversation while progress mirrors into the Tasks panel. ' +
          'Tool calls, plan steps, errors, and final output stay visible live in chat and are also persisted on the task card. ' +
          'Use this when the user wants the work tracked as a task/run while still seeing the live chat stream. ' +
          'This does not launch a silent detached background runner; for short ephemeral parallel work, use background_spawn instead.',
        description:
          'Start a persisted task card for the current live chat turn. Continue executing the task here in this same conversation; tool calls, plan steps, errors, and final output are mirrored into the Tasks panel. This does not launch a silent detached background runner.',
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
