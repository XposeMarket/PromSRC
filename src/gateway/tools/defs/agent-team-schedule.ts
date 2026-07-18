// src/gateway/tools/defs/agent-team-schedule.ts
// Tool definitions for agent management, team collaboration, and scheduling.

export function getAgentTeamScheduleTools(): any[] {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'agent_ops',
        description: 'Unified agent lifecycle wrapper for listing, inspecting, creating/spawning, updating, deleting, and deploying analysis teams.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['spawn', 'list', 'info', 'update', 'delete', 'deploy_analysis_team'] },
            subagent_id: { type: 'string' },
            agent_id: { type: 'string' },
            task_prompt: { type: 'string' },
            run_now: { type: 'boolean' },
            from_role: { type: 'string', enum: ['planner', 'orchestrator', 'researcher', 'analyst', 'builder', 'operator', 'verifier'] },
            specialization: { type: 'string' },
            create_if_missing: { type: 'object' },
            context_data: { type: 'object' },
            patch: {
              type: 'object',
              description: 'For action="update": fields to update. These are flattened into agent_update. Top-level aliases are also accepted.',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                system_instructions: { type: 'string' },
                heartbeat_instructions: { type: 'string' },
                model: { type: 'string' },
                max_steps: { type: 'number' },
                maxSteps: { type: 'number' },
                timeout_ms: { type: 'number' },
                timeoutMs: { type: 'number' },
                constraints: { type: 'array', items: { type: 'string' } },
                success_criteria: { type: 'string' },
                allowed_tools: { type: 'array', items: { type: 'string' } },
                forbidden_tools: { type: 'array', items: { type: 'string' } },
                allowed_work_paths: { type: 'array', items: { type: 'string' } },
                execution_workspace: { type: 'string' },
              },
            },
            confirm: { type: 'boolean' },
            goal: { type: 'string' },
            context: { type: 'string' },
            name: { type: 'string', description: 'For action="update": new display name.' },
            description: { type: 'string', description: 'For action="update": new description.' },
            model: { type: 'string', description: 'For action="update": explicit model route.' },
            max_steps: { type: 'number', description: 'For action="update": maximum tool steps.' },
            timeout_ms: { type: 'number', description: 'For action="update": timeout in milliseconds.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'agent_chat_ops',
        description: 'Unified direct/background agent messaging wrapper. chat_with_subagent remains core for ordinary known-agent check-ins.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['talk', 'message', 'send', 'turn_request', 'reply_wait', 'thread_watch'] },
            agent_id: { type: 'string' },
            subagent_id: { type: 'string' },
            message: { type: 'string' },
            task_prompt: { type: 'string' },
            context: { type: 'string' },
            thread_id: { type: 'string' },
            request_id: { type: 'string' },
            timeout_ms: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'team_ops_wrapper',
        description: 'Unified managed-team wrapper for team lifecycle, goals, context refs, dispatches, chat, and member result coordination.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['manage', 'delete', 'manage_goal', 'manage_context_ref', 'update_goal', 'reply', 'post_chat', 'message_main', 'dispatch', 'dispatch_team_agent', 'request_member_turn', 'get_agent_result'] },
            team_action: { type: 'string', description: 'Sub-action for action="manage", e.g. list/create/start/dispatch/pause/resume/delete.' },
            team_id: { type: 'string' },
            teamId: { type: 'string' },
            agent_id: { type: 'string' },
            subagent_id: { type: 'string' },
            task: { type: 'string' },
            task_prompt: { type: 'string' },
            message: { type: 'string' },
            content: { type: 'string' },
            goal: { type: 'string' },
            context: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            purpose: { type: 'string' },
            team_context: { type: 'string' },
            manager_system_prompt: { type: 'string' },
            manager_model: { type: 'string' },
            review_trigger: { type: 'string', enum: ['after_each_run', 'after_all_runs', 'daily', 'manual'] },
            subagent_ids: { type: 'array', items: { type: 'string' } },
            add_subagent_ids: { type: 'array', items: { type: 'string' } },
            remove_subagent_ids: { type: 'array', items: { type: 'string' } },
            allowed_work_paths: { type: 'array', items: { type: 'string' } },
            kickoff_initial_review: { type: 'boolean' },
            kickoff_after_seconds: { type: 'number' },
            ref: { type: 'string' },
            request_id: { type: 'string' },
            confirm: { type: 'boolean' },
            delete_agents: { type: 'boolean' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'team_collab_ops',
        description: 'Unified teammate collaboration wrapper for manager/teammate talk, context/help requests, artifacts, and status updates.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['talk_manager', 'request_context', 'request_manager_help', 'talk_teammate', 'share_artifact', 'update_status'] },
            team_id: { type: 'string' },
            teammate_id: { type: 'string' },
            agent_id: { type: 'string' },
            message: { type: 'string' },
            request: { type: 'string' },
            context: { type: 'string' },
            artifact: { type: 'object' },
            status: { type: 'string' },
          },
        },
      },
    },
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
              description: 'Concrete standalone specialization when using from_role. If the agent is later added to a team, this can become its team role. E.g. "Prospect Researcher: finds local small-business leads from maps/directories/search."',
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
                skillIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Installed skill IDs to attach to this subagent. The runtime will remind the agent to skill_read relevant attached skills before work.',
                },
                context_refs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['title', 'content'],
                    properties: {
                      title: { type: 'string', description: 'Short title for this context card' },
                      content: { type: 'string', description: 'Context content to attach to the subagent profile' },
                    },
                  },
                  description: 'Context reference cards to attach when creating this subagent. These are the same context refs shown in the Agents UI.',
                },
                system_instructions: {
                  type: 'string',
                  description: 'Full identity and operating instructions for this agent. Written to AGENT.md and used every time the agent runs.',
                },
                heartbeat_instructions: {
                  type: 'string',
                  description: 'Written to HEARTBEAT.md. Used by this agent heartbeat when enabled. Include what to check, what to do, when to stop, and the rule: if no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else.',
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
                reasoning_effort: {
                  type: 'string',
                  enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
                  description: 'Optional provider/model-aware reasoning effort for this subagent.',
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
          'This keeps config.json, AGENT.md, and the Agents UI in sync for dynamic subagents.',
        parameters: {
          type: 'object',
          required: ['agent_id'],
          properties: {
            agent_id: { type: 'string', description: 'The dynamic subagent ID to update (get IDs from agent_list first)' },
            name: { type: 'string', description: 'New display name shown in Agents and Teams UI' },
            description: { type: 'string', description: 'New short description / specialty summary' },
            system_instructions: { type: 'string', description: 'Full replacement instructions for AGENT.md' },
            heartbeat_instructions: { type: 'string', description: 'Full replacement content for HEARTBEAT.md. Must include the HEARTBEAT_OK silence rule for no-op heartbeats.' },
            executionWorkspace: { type: 'string', description: 'Default working directory for this agent. Must be inside allowedWorkPaths.' },
            execution_workspace: { type: 'string', description: 'Alias for executionWorkspace.' },
            allowedWorkPaths: { type: 'array', items: { type: 'string' }, description: 'Full replacement allowed work roots. Defaults include the main workspace; relative paths resolve inside it.' },
            allowed_work_paths: { type: 'array', items: { type: 'string' }, description: 'Alias for allowedWorkPaths.' },
            constraints: { type: 'array', items: { type: 'string' }, description: 'Full replacement constraints list' },
            success_criteria: { type: 'string', description: 'Full replacement success criteria' },
            allowed_tools: { type: 'array', items: { type: 'string' }, description: 'Legacy full replacement individual tool names' },
            forbidden_tools: { type: 'array', items: { type: 'string' }, description: 'Full replacement explicit blacklist' },
            skillIds: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of installed skill IDs attached to this subagent' },
            context_refs: {
              type: 'object',
              description: 'Update attached context refs. Use add:[{title,content}], update:[{id,title?,content?}], delete:[id], or replace:[{title,content}]. agent_info/agent_update return context ref IDs.',
              properties: {
                add: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['title', 'content'],
                    properties: {
                      title: { type: 'string' },
                      content: { type: 'string' },
                    },
                  },
                  description: 'Context refs to append',
                },
                update: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                    },
                  },
                  description: 'Existing context refs to update by ID',
                },
                delete: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Context ref IDs to remove',
                },
                replace: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['title', 'content'],
                    properties: {
                      title: { type: 'string' },
                      content: { type: 'string' },
                    },
                  },
                  description: 'Replace all existing context refs with this list',
                },
              },
            },
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
          'Create a NEW background task for a standalone one-off subagent and return a task id immediately. ' +
          'Do not use this to add or change instructions on an existing run; inspect it and use agent_run_ops(action="steer") instead. ' +
          'Use this when the user wants the main chat agent to hand work or a question to an existing standalone subagent as a peer while main chat continues. ' +
          'The subagent working conversation and final result stay in the subagent task panel, not the main chat. This is not team dispatch and only works for subagents that are not assigned to a managed team. Call agent_list() first if you are unsure of the ID.',
        parameters: {
          type: 'object',
          required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'ID of the standalone subagent to message.' },
            message: { type: 'string', description: 'Plain-language assignment for the new background task. Include the task or question.' },
            context: { type: 'string', description: 'Optional additional context from the main chat.' },
            force_new_task: { type: 'boolean', description: 'Required true when this agent already has an active run and the user explicitly requested separate parallel work.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'chat_with_subagent',
        description:
          'Have a normal conversational chat turn with an existing standalone non-team subagent and wait for its reply. ' +
          'This uses the persistent Subagents chat thread, not a one-off task dispatch. Use it for check-ins, status questions, lightweight collaboration, greetings, planning, or follow-up discussion. ' +
          'For background task handoff use message_subagent instead. For team members use agent_message_send or agent_turn_request with target_type="team_member".',
        parameters: {
          type: 'object',
          required: ['agent_id', 'message'],
          properties: {
            agent_id: { type: 'string', description: 'ID of the standalone non-team subagent to chat with.' },
            message: { type: 'string', description: 'Conversational message to send.' },
            context: { type: 'string', description: 'Optional extra context to include below the message.' },
            timeout_ms: { type: 'number', description: 'How long to wait for the reply. Default 300000, max 1800000.' },
            user_label: { type: 'string', description: 'Optional label shown to the subagent, default "Main Agent".' },
            include_history: { type: 'boolean', description: 'Include recent thread history. Default false.' },
            history_limit: { type: 'number', description: 'History turns when included. Default 3, max 20.' },
            include_thinking: { type: 'boolean', description: 'Include model thinking when available. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_message_send',
        description:
          'Send a mailbox/direct-chat message to another agent without forcing it to be a formal task. ' +
          'Targets standalone subagents, team members, or a team manager. By default this only delivers/queues the message; set request_turn=true when you want the target to reply now. ' +
          'Set background=true with request_turn=true to wake/run the target asynchronously where supported.',
        parameters: {
          type: 'object',
          required: ['target_type', 'message'],
          properties: {
            target_type: {
              type: 'string',
              enum: ['standalone_subagent', 'team_member', 'team_manager'],
              description: 'Destination kind. standalone_subagent requires agent_id. team_member requires team_id and agent_id. team_manager requires team_id.',
            },
            agent_id: { type: 'string', description: 'Target agent ID for standalone_subagent or team_member.' },
            team_id: { type: 'string', description: 'Target team ID for team_member or team_manager.' },
            message: { type: 'string', description: 'Message to deliver.' },
            context: { type: 'string', description: 'Optional extra context appended below the message.' },
            request_turn: { type: 'boolean', description: 'If true, ask/wake the target to answer. Default false.' },
            background: { type: 'boolean', description: 'With request_turn=true, start the reply turn asynchronously when supported.' },
            delay_ms: { type: 'number', description: 'Optional delay before a background team-member direct wake.' },
            timeout_ms: { type: 'number', description: 'Max wait for synchronous standalone chats. Default 300000, max 1800000.' },
            user_label: { type: 'string', description: 'Optional sender label. Default "Main Agent".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_turn_request',
        description:
          'Ask another agent to take a conversational turn and reply. This is the compact send+reply shortcut for agent chat, not a formal execution dispatch. ' +
          'Use standalone_subagent for the persistent Subagents chat thread, team_member for a team direct thread, or team_manager for a direct manager thread.',
        parameters: {
          type: 'object',
          required: ['target_type', 'prompt'],
          properties: {
            target_type: {
              type: 'string',
              enum: ['standalone_subagent', 'team_member', 'team_manager'],
              description: 'Destination kind. standalone_subagent requires agent_id. team_member requires team_id and agent_id. team_manager requires team_id.',
            },
            agent_id: { type: 'string', description: 'Target agent ID for standalone_subagent or team_member.' },
            team_id: { type: 'string', description: 'Target team ID for team_member or team_manager.' },
            prompt: { type: 'string', description: 'What the target should respond to.' },
            context: { type: 'string', description: 'Optional extra context appended below the prompt.' },
            background: { type: 'boolean', description: 'For team member/manager targets, request the reply asynchronously.' },
            delay_ms: { type: 'number', description: 'Optional delay before a background team-member direct wake.' },
            timeout_ms: { type: 'number', description: 'Max wait for synchronous standalone chats. Default 300000, max 1800000.' },
            user_label: { type: 'string', description: 'Optional sender label. Default "Main Agent".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_reply_wait',
        description:
          'Wait for or poll replies from an agent chat/thread after a known timestamp. Use after agent_message_send(... request_turn=true/background=true) or when a heartbeat wants to check whether a target replied. ' +
          'For background task ids returned by message_subagent, dispatch_team_agent, or request_team_member_turn, use get_agent_result instead.',
        parameters: {
          type: 'object',
          required: ['target_type'],
          properties: {
            target_type: {
              type: 'string',
              enum: ['standalone_subagent', 'team_member', 'team_manager'],
              description: 'Thread kind to poll.',
            },
            agent_id: { type: 'string', description: 'Standalone subagent ID or team member agent ID.' },
            team_id: { type: 'string', description: 'Team ID for team_member or team_manager.' },
            thread_id: { type: 'string', description: 'Optional team direct thread id. Omit to read all matching replies after after_ts.' },
            after_ts: { type: 'number', description: 'Only return replies newer than this timestamp. Use after_ts from agent_message_send or agent_turn_request results.' },
            block: { type: 'boolean', description: 'If true, wait until a reply arrives or timeout. Default true.' },
            timeout_ms: { type: 'number', description: 'Max wait when block=true. Default 30000, max 1800000.' },
            poll_ms: { type: 'number', description: 'Polling interval when block=true. Default 1000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_thread_watch',
        description:
          'Create a lightweight watch descriptor for an agent conversation thread, or block once like agent_reply_wait when block=true. ' +
          'Use the returned fields from a heartbeat or scheduled job to poll with agent_reply_wait. For durable task completion watches, use internal_watch with task ids.',
        parameters: {
          type: 'object',
          required: ['target_type'],
          properties: {
            target_type: {
              type: 'string',
              enum: ['standalone_subagent', 'team_member', 'team_manager'],
              description: 'Thread kind to watch.',
            },
            agent_id: { type: 'string', description: 'Standalone subagent ID or team member agent ID.' },
            team_id: { type: 'string', description: 'Team ID for team_member or team_manager.' },
            thread_id: { type: 'string', description: 'Optional team direct thread id.' },
            after_ts: { type: 'number', description: 'Watch replies newer than this timestamp. Defaults to now.' },
            watch_id: { type: 'string', description: 'Optional caller-chosen watch id.' },
            block: { type: 'boolean', description: 'If true, perform a bounded wait immediately instead of only returning a descriptor.' },
            timeout_ms: { type: 'number', description: 'Max wait when block=true. Default 30000, max 1800000.' },
            poll_ms: { type: 'number', description: 'Polling interval when block=true. Default 1000.' },
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
        description: 'Manage managed teams: list teams, create/start teams, trigger manager review, dispatch one-off tasks, or permanently delete teams.',
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
            delete_agents: { type: 'boolean', description: 'For delete: defaults true. If true, also permanently delete all member agents, their workspaces/chats, and their scheduled jobs. Set false only when intentionally keeping members.' },
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
	            instructions: { type: 'string', description: 'Full replacement content for this agent HEARTBEAT.md file. Must include the rule: if no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else.' },
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
          'Create, list, or cancel bounded internal watches that wake a normal tool-capable Prometheus main-chat turn when an internal condition changes. ' +
          'Use after triggering background work, request_team_member_turn(background=true), dispatch_team_agent(background=true), schedule_job(run_now), collectors, build/restart checks, or file-producing jobs so Prometheus does not have to manually poll. ' +
          'Supported targets: file, task, scheduled_job, event_queue. Watches require a TTL, persist across gateway restart, and default to firing once. delivery_mode defaults to run_turn, which wakes the creating chat with its history. A match is evidence, never an implicit task action. action_policy defaults to review_only and is enforced at task_control execution time; use stronger policies only with explicit prior authorization.',
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
              description: 'Instruction for run_turn delivery, or an operator-readable notification label for notify_only. Supports {{watch_id}}, {{watch_label}}, {{path}}, {{task_id}}, {{job_id}}, {{status}}, {{result}}, {{observation_json}}.',
            },
            rationale: { type: 'string', description: 'Why this watch is being created and what the creating thread should decide when it wakes. Stored privately with the watch.' },
            action_policy: {
              type: 'string',
              enum: ['review_only', 'recover_same_run', 'full_rerun_allowed'],
              description: 'Default review_only blocks watch-caused task mutation. recover_same_run permits only steer/message/resume of the watched incomplete run or scoped continue of the watched completed run. full_rerun_allowed additionally permits rerun only when explicitly selected and justified.',
            },
            delivery_session_id: { type: 'string', description: 'Optional explicit session to wake. Omit to wake the thread that created the watch.' },
            delivery_mode: {
              type: 'string',
              enum: ['run_turn', 'notify_only'],
              description: 'Default run_turn starts the normal tool-capable follow-up. notify_only broadcasts the matched observation without invoking a model turn.',
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
	        description: 'Manage scheduled jobs: list/create/update/pause/resume/delete/run_now. Default owner is Prometheus; use subagent_id or team_id only when delegation is intended.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: list, create, update, pause, resume, delete, run_now' },
            job_id: { type: 'string', description: 'Required for update/pause/resume/delete/run_now' },
            name: { type: 'string', description: 'Job name (create/update)' },
            instruction_prompt: { type: 'string', description: 'Required for create. Self-contained instructions the future run receives; include steps, constraints, and success criteria.' },
            schedule: {
              type: 'object',
              description: 'Recurring/one-shot schedule. Accepts cron/run_at or friendly fields like repeat/time, days_of_week/time, every_hours, every_days, or text.',
              properties: {
                kind: { type: 'string', description: 'recurring or one_shot' },
                cron: { type: 'string', description: 'Cron expression for recurring jobs' },
                run_at: { type: 'string', description: 'ISO timestamp for one-shot jobs' },
                text: { type: 'string', description: 'Natural language schedule, e.g. "weekdays at 9am" or "Mon/Wed/Fri at 14:30".' },
                repeat: { type: 'string', description: 'Friendly recurrence preset: daily, weekday, weekend, weekly.' },
                time: { type: 'string', description: 'Local time for daily/day-of-week repeats, HH:MM or 12-hour format.' },
                days_of_week: { type: 'array', items: { type: 'string' }, description: 'Days to run: monday/tuesday/... or sun/mon/...; use for custom day sets.' },
                every_hours: { type: 'number', description: 'Run every N hours. Compiles to cron minute */N hour pattern.' },
                every_days: { type: 'number', description: 'Run every N days at time. Compiles to cron day-of-month interval.' },
              },
            },
            timezone: { type: 'string', description: 'IANA timezone (e.g. America/New_York)' },
            delivery: {
              type: 'object',
              properties: {
                channel: { type: 'string', description: 'web, telegram, discord, whatsapp' },
                session_target: { type: 'string', description: 'Legacy compatibility only. Omit for normal schedules; ownership is controlled by subagent_id/team_id. If "main" is supplied without subagent_id/team_id, the job remains assigned to Prometheus itself.' },
              },
            },
            model_override: { type: 'string', description: 'Optional model override for this scheduled job' },
	            subagent_id: { type: 'string', description: 'Optional configured subagent owner. Omit on update to preserve existing owner; pass "" to return ownership to Prometheus.' },
            team_id: { type: 'string', description: 'Optional: managed team ID. When set, the scheduled run wakes that team manager first; the manager derives the run from team goal/memory and dispatches agents accordingly.' },
            skillIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Installed skill IDs to attach to this scheduled job. The runtime will remind the scheduled run to skill_read relevant attached skills before work.',
            },
            context_refs: {
              type: 'array',
              items: {
                type: 'object',
                required: ['title', 'content'],
                properties: {
                  id: { type: 'string', description: 'Optional existing context reference ID for updates.' },
                  title: { type: 'string', description: 'Short title for this schedule context card.' },
                  content: { type: 'string', description: 'Context content injected when the schedule runs.' },
                },
              },
              description: 'Full replacement schedule context cards for create/update.',
            },
            confirm: { type: 'boolean', description: 'Must be true for create/update/delete actions' },
            limit: { type: 'number', description: 'Optional max jobs returned for list' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_run_ops',
        description:
          'Inspect and operate on existing agent-owned task runs. Use this for subagent Runs/recovery, not normal Home chat. ' +
          'List/get responses include current step, unfinished/failed steps, runtime progress, last tool call, last journal event, and live runner state. ' +
          'steer injects new guidance into an actively running task without creating another task. recover is only for a paused/stalled run-attached recovery conversation. ' +
          'Use chat_with_subagent for normal persistent subagent chat. Use message_subagent only when the user explicitly wants a separate new background handoff.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'steer', 'recover', 'resume', 'rerun', 'pause', 'cancel', 'benchmark_disposable'],
              description: 'list/get inspect runs; steer joins active work; recover chats in paused task recovery mode; resume/rerun/pause/cancel control the existing run.',
            },
            agent_id: { type: 'string', description: 'Optional agent ID. Required for agent-scoped lists; optional with task_id because ownership can be derived from the task.' },
            task_id: { type: 'string', description: 'Task/run ID. Required for get/steer/recover/resume/rerun/pause/cancel.' },
            status: { type: 'string', description: 'Optional list filter: queued|running|paused|stalled|needs_assistance|awaiting_user_input|failed|complete|waiting_subagent. Comma/space separated values are allowed.' },
            recoverable_only: { type: 'boolean', description: 'For list, return only paused/stalled/failed/needs-input runs that can use recovery chat.' },
            limit: { type: 'number', description: 'For list, max runs returned. Default 20, max 100.' },
            detail: { type: 'string', enum: ['compact', 'full'], description: 'List payload detail. Default compact; use get for one hydrated run.' },
            message: { type: 'string', description: 'Guidance for action="steer", or a recovery chat message for action="recover".' },
            note: { type: 'string', description: 'Optional operator note for resume/rerun/pause/cancel actions.' },
            include_task: { type: 'boolean', description: 'For get/recover/control responses, include the full raw task record. Default false to keep tool output compact.' },
            include_evidence: { type: 'boolean', description: 'Include a capped evidence bus snapshot when available. Default true.' },
            confirm: { type: 'boolean', description: 'Required true for action="cancel".' },
            prompt: { type: 'string', description: 'Optional bounded prompt for benchmark_disposable.' },
            role: { type: 'string', description: 'Role route to verify for benchmark_disposable. Default researcher.' },
            model: { type: 'string', description: 'Optional explicit model override for benchmark_disposable.' },
            reasoning_effort: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], description: 'Optional reasoning override for benchmark_disposable.' },
            timeout_ms: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_control',
        description: 'Query, steer, and control existing background tasks, including their pending approvals. You may inspect approvals proactively. Resolve one only after the user explicitly authorizes that exact approval in the current conversation; never let a task approve itself.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: list, latest, get, steer, message, list_approvals, resolve_approval, resume, rerun, continue, pause, cancel, delete' },
            task_id: { type: 'string', description: 'Task ID. Strongly recommended for steer; required for get/pause/cancel/delete; optional for resume/rerun.' },
            status: { type: 'string', description: 'Optional filter: queued|running|paused|stalled|needs_assistance|awaiting_user_input|failed|complete|waiting_subagent' },
            include_all_sessions: { type: 'boolean', description: 'If true, list across all sessions/channels; default false (scoped)' },
            include_scheduled: { type: 'boolean', description: 'Include compact scheduled jobs in list output. Default false.' },
            limit: { type: 'number', description: 'Max tasks to return (default 20, max 100)' },
            message: { type: 'string', description: 'New guidance for steer/message. It is injected into the current task; no new task is created.' },
            new_work: { type: 'string', description: 'Required for continue on a completed task. Appends only this scoped follow-up while preserving the completed plan, final summary, and evidence.' },
            resume_after_message: { type: 'boolean', description: 'If steering a paused task, resume that same task after recording the guidance. Default false.' },
            note: { type: 'string', description: 'Optional operator note for control actions; also accepted as steer text for compatibility.' },
            confirm: { type: 'boolean', description: 'Required true for destructive actions cancel/delete' },
            approval_id: { type: 'string', description: 'Exact approval ID for resolve_approval.' },
            decision: { type: 'string', enum: ['approve', 'reject'], description: 'Decision for resolve_approval.' },
            grant_scope: { type: 'string', enum: ['once', 'session', 'always'], description: 'Permission scope for an approved command/tool request. Default once. One-shot approval kinds only allow once.' },
            user_authorized: { type: 'boolean', description: 'Required true for resolve_approval. Set it only when the user explicitly authorized this exact approve/reject decision in the current conversation.' },
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
            delivery: { type: 'object', description: 'Delivery patch. Currently supports channel:web. session_target is legacy; use subagent_id/team_id to change ownership, or clear subagent_id to return ownership to Prometheus itself.' },
            model_override: { type: 'string', description: 'Optional model override; empty string clears.' },
            enabled: { type: 'boolean', description: 'Enable or pause the job.' },
            skillIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Full replacement list of installed skill IDs attached to this scheduled job.',
            },
            context_refs: {
              type: 'array',
              description: 'Full replacement schedule context cards. Use schedule_job_detail first if preserving existing cards while editing.',
              items: {
                type: 'object',
                required: ['title', 'content'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
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
            expected_result: {
              type: 'object',
              description: 'Optional semantic contract for the scheduled textual result.',
              properties: {
                requiredText: { type: 'string' },
                absentText: { type: 'string' },
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
        name: 'diagnostic_packet',
        description: 'Create, get, list, or resolve a sanitized structured Prometheus incident packet under workspace/diagnostics/incidents. Public-safe: records evidence and recovery attempts but never edits application source.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['create', 'get', 'list', 'resolve'] },
            packet_id: { type: 'string' }, limit: { type: 'number' },
            classification: { type: 'string', enum: ['agent','task','team','schedule','provider','configuration','dependency','workspace','application_defect','unknown'] },
            severity: { type: 'string', enum: ['low','medium','high','critical'] }, confidence: { type: 'string', enum: ['low','medium','high'] },
            observed_behavior: { type: 'string' }, expected_behavior: { type: 'string' }, minimal_reproduction: { type: 'array', items: { type: 'string' } },
            affected_subsystem: { type: 'string' }, evidence: { type: 'array', items: { type: 'object' } }, attempted_recoveries: { type: 'array', items: { type: 'object' } },
            operational_recovery_exhausted: { type: 'boolean' }, unresolved_uncertainty: { type: 'array', items: { type: 'string' } }, sanitized_summary: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'system_diagnostics',
        description: 'Public-safe, read-only Prometheus incident snapshot combining gateway heartbeat, automation anomalies, runtimes, recurring errors, cached provider health, restart state, build status, and audit freshness. Use first for explicit Self Repair requests; it never changes state or exposes source/dev capabilities.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            depth: { type: 'string', enum: ['summary', 'full'], description: 'Summary by default; full includes bounded sanitized runtime items.' },
            focus: { type: 'string', enum: ['all', 'gateway', 'runtime', 'automation', 'provider', 'audit', 'restart', 'errors'] },
            limit: { type: 'number', description: 'Maximum anomalous items per section. Default 10, maximum 50.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prometheus_thread_ops',
        description:
          'Find, inspect, create, rename, pin, message, steer, interrupt, and supervise other Prometheus chat sessions. ' +
          'Use create_many to split a request into separate first-class Prometheus threads. follow=true starts Goal mode in each target and reports terminal completion, blocking, or failure back to this owner thread. ' +
          'For active supervision, work as a manager loop: inspect the target, compare it to the objective and acceptance criteria, decide whether to wait/steer/report, and only accept after independent verification. ' +
          'revise_supervision, pause_supervision, and resume_supervision preserve the same owner/target workflow; they never silently replace the target thread. This controls Prometheus sessions, not subagents, background task records, or Codex threads.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'find', 'read', 'status', 'create', 'create_many', 'send', 'steer', 'interrupt', 'rename', 'pin', 'unpin', 'follow', 'unfollow', 'supervisions', 'review_decision', 'revise_supervision', 'pause_supervision', 'resume_supervision'],
              description: 'Peer-session operation. Use steer instead of send while the target is actively running.',
            },
            session_id: { type: 'string', description: 'Target Prometheus session id.' },
            supervision_id: { type: 'string', description: 'Supervision id for review decisions, supervised send/steer, unfollow, revise, pause, or resume.' },
            review_event_id: { type: 'string', description: 'Exact pending event id for an active-supervision review decision.' },
            decision: { type: 'string', enum: ['wait', 'continue', 'verified_complete', 'needs_user', 'failed'], description: 'Authoritative active-supervision review outcome. Only verified_complete may finalize success.' },
            progress_made: { type: 'boolean', description: 'Supervisor judgment of objective progress during this review. True requires bounded evidence.' },
            evidence: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 500 }, description: 'Bounded implementation or verification evidence supporting a review decision.' },
            query: { type: 'string', description: 'Full-history search text for find.' },
            title: { type: 'string', description: 'Thread title for create or rename.' },
            prompt: { type: 'string', description: 'Initial work prompt for create, or message text for send/steer.' },
            message: { type: 'string', description: 'Message for send or steer.' },
            objective: { type: 'string', description: 'Autonomous completion objective for create/follow. Defaults to prompt.' },
            acceptance_criteria: { type: 'string', description: 'Explicit completion checks for create/follow/revise_supervision. Defaults to objective.' },
            workspace: { type: 'string', description: 'Optional target workspace. Defaults to the owner thread workspace.' },
            follow: { type: 'boolean', description: 'For create/create_many: enter autonomous Goal mode and durably supervise. Default true.' },
            max_reviews: { type: 'number', description: 'Optional active-supervision review budget. Default 12.' },
            max_follow_ups: { type: 'number', description: 'Optional supervised send/steer budget. Default 6.' },
            max_elapsed_ms: { type: 'number', description: 'Optional elapsed-time budget. Default 24 hours.' },
            min_review_interval_ms: { type: 'number', description: 'Minimum interval between model reviews. Default 15000ms.' },
            max_consecutive_no_progress: { type: 'number', description: 'Hard stop after this many no-progress reviews. Default 3.' },
            wait: { type: 'boolean', description: 'For send: wait for the full target reply. Default false (detached).' },
            requires_response: { type: 'boolean', description: 'For steer: whether the live worker should respond. Default true.' },
            history_limit: { type: 'number', description: 'For read: maximum recent messages, default 60, max 200.' },
            include_history: { type: 'boolean', description: 'For status: include recent messages.' },
            include_terminal: { type: 'boolean', description: 'For supervisions: include completed/blocked/failed/cancelled records. Default true.' },
            include_automated: { type: 'boolean', description: 'For list: include scheduled automation sessions.' },
            all_owners: { type: 'boolean', description: 'For supervisions/unfollow: operate across owner sessions. Use only when the user asks.' },
            reason: { type: 'string', description: 'Reason for interrupting/pausing a target.' },
            status: { type: 'string', enum: ['active', 'paused', 'complete', 'blocked', 'failed', 'cancelled'], description: 'Filter supervision status.' },
            channel: { type: 'string', enum: ['terminal', 'telegram', 'web', 'mobile', 'discord', 'whatsapp', 'system'], description: 'Optional session list/search channel filter.' },
            limit: { type: 'number', description: 'Maximum results.' },
            offset: { type: 'number', description: 'Session list offset.' },
            threads: {
              type: 'array',
              maxItems: 24,
              description: 'For create_many: one specification per new Prometheus thread. Threads launch independently and concurrently.',
              items: {
                type: 'object',
                required: ['title', 'prompt'],
                properties: {
                  title: { type: 'string' },
                  prompt: { type: 'string' },
                  objective: { type: 'string' },
                  workspace: { type: 'string' },
                  follow: { type: 'boolean' },
                  session_id: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prometheus_request_ops',
        description:
          'Read and recover durable Prometheus requests across sessions: dev-source edits, approvals, proposals, and user questions. ' +
          'Use recovery_candidates when the user says work was cut off or interrupted. recover only resumes an existing approved dev edit in its original owning thread; it never approves, completes, or marks changes live.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'find', 'read', 'status', 'recovery_candidates', 'recover'],
            },
            request_id: { type: 'string', description: 'Exact durable request/dev-edit/approval/proposal/question ID.' },
            query: { type: 'string', description: 'Text search across request plans, summaries, files, sessions, and statuses.' },
            kind: { type: 'string', enum: ['dev_source_edit', 'approval', 'proposal', 'question'] },
            status: { type: 'string', description: 'Optional exact status filter.' },
            session_id: { type: 'string', description: 'Optional owning-session filter.' },
            depth: { type: 'string', enum: ['summary', 'full'], description: 'Full includes plans, touched files, verification, and request-specific data.' },
            limit: { type: 'number', description: 'Maximum results, default 50 and maximum 200.' },
            message: { type: 'string', description: 'Optional user recovery note included in the guarded handoff.' },
            reason: { type: 'string', description: 'Alias for message during recover.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'automation_dashboard',
        description:
          'Unified read-only operator snapshot for priorities, agents, schedules, tasks, managed Prometheus threads, teams, watches, recent outputs, and app update status. Prefer over chaining granular list/detail tools.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            limit: { type: 'number', description: 'Max jobs/tasks/managed threads/watches/events per section. Default 25.' },
            include_done: { type: 'boolean', description: 'Include completed/cancelled internal watches, not just active watches.' },
            depth: { type: 'string', enum: ['summary', 'full'], description: 'summary (default) caps produced output/results for a compact snapshot; full returns untruncated output for reading actual work product.' },
            agent_id: { type: 'string', description: 'Optional: focus the snapshot on a single agent (its jobs, tasks, recent runs, last output). Omits the teams section.' },
            include: {
              type: 'array',
              items: { type: 'string', enum: ['agents', 'teams', 'outputs'] },
              description: 'Optional: narrow which extra sections to compute. Default is all. "agents" = per-agent joined view, "teams" = team rollups, "outputs" = recent runs + last produced output per agent.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'background_ops',
        description:
          'Unified background agent wrapper. action="spawn" starts an ephemeral parallel agent whose result is auto-merged at turn end; action="wait" briefly pauses this foreground turn; action="status"/"progress" checks state; action="join" is system-use only and normally unnecessary.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['spawn', 'status', 'progress', 'wait', 'join'],
              description: 'Background operation to run.',
            },
            prompt: {
              type: 'string',
              description: 'For spawn: fully self-contained task instructions. Include all context, paths, URLs, and exact parameters.',
            },
            task_prompt: {
              type: 'string',
              description: 'Alias for prompt.',
            },
            background_id: {
              type: 'string',
              description: 'Background agent ID for status/progress/wait/join.',
            },
            background_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional IDs for wait.',
            },
            wait_ms: {
              type: 'number',
              description: 'For wait: foreground pause duration in milliseconds.',
            },
            timeout_ms: {
              type: 'number',
              description: 'Timeout for wait/join, or turn-end wait cap for spawn policies.',
            },
            join_policy: {
              type: 'string',
              enum: ['wait_all', 'wait_until_timeout', 'best_effort_merge'],
              description: 'Spawn/join merge policy. Default spawn policy is wait_all.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional spawn tracking tags.',
            },
            model: { type: 'string', description: 'Optional explicit spawn model override; otherwise background_task routing is used.' },
            provider: { type: 'string', description: 'Optional explicit provider override.' },
            reasoning_effort: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], description: 'Optional provider/model-aware reasoning override for this spawn.' },
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
          'PREFER FOR ASAP/URGENT PARALLEL WORK: when work needs to start immediately but should not block your current tool sequence, use background_spawn instead of subagent_spawn. ' +
          'Good fits include independent memory writes, codebase scans, web research, and other data gathering that can run while the main flow continues.\n\n' +
          'USE WHEN all 3 conditions are true:\n' +
          '  1. The work is independent of your primary tool sequence (no shared dependencies)\n' +
          '  2. It can start right now with everything it needs (all context is in the prompt)\n' +
          '  3. You do NOT need its result before your immediate next action\n\n' +
          'DO NOT USE WHEN: the result is required to choose your next step, this IS your primary blocking task, or you need a durable named subagent/persona.\n\n' +
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
            model: { type: 'string', description: 'Optional model override.' },
            provider: { type: 'string', description: 'Optional provider override.' },
            reasoning_effort: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], description: 'Optional reasoning override.' },
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
          'Mark the current declare_plan phase finished and move to the next plan line. Use after you finish a phase (e.g. desktop focus + screenshots done) before starting the next. For create/write/build/edit phases, only call this after an actual successful write/create/patch/edit tool and verification evidence. Not needed for browser/desktop-only work until the phase is actually complete.',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'Concrete one-line evidence, including file/tool result when relevant (e.g. "Created games/foo/index.html with create_file and verified with file_stats").' },
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
              description: 'Optional: ID of a configured subagent to inherit system instructions from. If provided, the subagent\'s AGENT.md is injected as context for the task.',
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

export function ensurePrometheusThreadOpsForSupervision(toolDefs: any[], enabled: boolean): any[] {
  if (!enabled || toolDefs.some((tool: any) => String(tool?.function?.name || '') === 'prometheus_thread_ops')) return toolDefs;
  const definition = getAgentTeamScheduleTools()
    .find((tool: any) => String(tool?.function?.name || '') === 'prometheus_thread_ops');
  return definition ? [definition, ...toolDefs] : toolDefs;
}
