// src/gateway/tools/defs/cis-system.ts
// Tool definitions for CIS (Competitive Intelligence System), self-improvement, and system management.

import { filterPublicBuildToolDefs, getPublicBuildAllowedCategories } from '../../../runtime/distribution.js';

export function getCisSystemTools(): any[] {
  const categoryDocs: Array<[string, string]> = [
    ['browser_automation', 'browser_automation - browser_session/browser_observe/browser_act/browser_extract wrappers.'],
    ['desktop_automation', 'desktop_automation - desktop_screen/apps/window/input/macro/background wrappers.'],
    ['agents_and_teams', 'agents_and_teams - agent_ops/agent_chat_ops/team wrappers.'],
    ['prometheus_source_read', 'prometheus_source_read - dev_source_read for Prometheus source/web-ui/root inspection.'],
    ['prometheus_source_write', 'prometheus_source_write - dev_source_edit for approved Prometheus src/web-ui edits.'],
    ['workspace_write', 'workspace_write - unified workspace read/edit/run/git/safety/code-nav wrappers.'],
    ['advanced_memory', 'advanced_memory - memory graph, timeline, related records, index ops.'],
    ['media_assets', 'media_assets - download/analyze images, video, audio, remote assets.'],
    ['creative_quality', 'creative_quality - creative_quality_ops image/video QA checks.'],
    ['automations', 'automations - advanced schedule/task/watch diagnostics and repair.'],
    ['external_apps', 'external_apps - connected app wrappers; call connector_list first.'],
    ['integration_admin', 'integration_admin - MCP/webhook/integration setup.'],
    ['social_intelligence', 'social_intelligence - social profile analysis.'],
    ['proposal_admin', 'proposal_admin - edit pending proposals.'],
    ['mcp_server_tools', 'mcp_server_tools - connected MCP tools as mcp__server__tool.'],
    ['composite_tools', 'composite_tools - saved multi-step tools.'],
    ['creative_basic', 'creative_basic - creative_project and creative_scene wrappers.'],
    ['creative_image', 'creative_image - creative_image_ops wrapper.'],
    ['creative_video', 'creative_video - creative_video_ops wrapper.'],
    ['creative_hyperframes', 'creative_hyperframes - creative_hyperframes_ops wrapper.'],
    ['skills', 'skills - skill authoring/maintenance beyond skill_list/skill_read.'],
    ['model_management', 'model_management - agent model defaults/templates.'],
    ['business', 'business - structured business entity files/events.'],
  ];
  const categoryEnum = getPublicBuildAllowedCategories([
    'browser_automation',
    'desktop_automation',
    'agents_and_teams',
    'prometheus_source_read',
    'prometheus_source_write',
    'workspace_write',
    'advanced_memory',
    'media_assets',
    'creative_quality',
    'automations',
    'external_apps',
    'integration_admin',
    'social_intelligence',
    'proposal_admin',
    'mcp_server_tools',
    'composite_tools',
    'creative_basic',
    'creative_image',
    'creative_video',
    'creative_hyperframes',
    'skills',
    'model_management',
    'business',
  ] as const);
  const requestToolCategoryDescription =
    'Activate one on-demand tool category. Default scope is turn, so large tool groups do not stay loaded after the current user turn. ' +
    'Use scope=session only when the user is clearly entering a longer workflow that should keep the category available across later turns. ' +
    'Use scope=next_turn for the current turn plus one follow-up user turn, or scope=ttl with turns for a bounded multi-turn workflow. Available categories:\n' +
    categoryDocs
      .filter(([category]) => categoryEnum.includes(category as any))
      .map(([, line]) => `  ${line}`)
      .join('\n');

  const tools = [
    // ── ask_team_coordinator: delegate team creation/queries to the meta-coordinator ──
    {
      type: 'function',
      function: {
        name: 'ask_team_coordinator',
        description: [
          'Delegate ALL team-related work to the meta-coordinator. Use this whenever:',
          '  - The user asks to create a team, run a team, or do something that needs a team',
          '  - The user asks about the status of a team or what a team is doing',
          '  - Any team management action is needed (pause, update goal, query team state)',
          'The coordinator has full knowledge of the teams system, role registry, and all team tools.',
          'It creates the team (or handles the query), then returns a summary. Team runs autonomously after.',
          'IMPORTANT: Do NOT call team_manage directly from main chat. Use this tool for managed team work. Standalone one-off subagents are separate: main chat may use chat_with_subagent for normal conversation. Activate agents_and_teams for spawn_subagent creation/work or message_subagent background task handoff with a single non-team agent.',
        ].join(' '),
        parameters: {
          type: 'object',
          required: ['goal'],
          properties: {
            goal: {
              type: 'string',
              description: 'What you need the team coordinator to do. For team creation: the full goal. For queries: the question about the team (e.g. "What is team X working on?"). Be specific.',
            },
            context: {
              type: 'string',
              description: 'Any additional context the coordinator needs — relevant background, constraints, preferences.',
            },
          },
        },
      },
    },
    // ── deploy_analysis_team: one-shot website intelligence team (CIS Phase 2) ─
    {
      type: 'function',
      function: {
        name: 'deploy_analysis_team',
        description:
          'Run a full go-to-market website analysis for any URL. ' +
          'It deploys background specialists for business profiling, SEO discovery, social reputation, browser funnel testing, CRO and messaging critique, technical auditing, and competitive positioning. ' +
          'It returns a structured GTM intelligence bundle plus downloadable artifacts for the main agent to compile into an inline interactive HTML dashboard, followed by a full written marketing, sales, and site-improvement plan. ' +
          'Do not call present_file after this tool. The final experience should be inline, not file-first. ' +
          'Use when the user asks to analyze, audit, check, or investigate any website.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'The full URL to analyze (must include https://)' },
            save_to_entity: { type: 'string', description: 'Optional: entity slug to save report summary to (e.g. "acme-corp")' },
          },
        },
      },
    },
    // ── present_file: open a file in the canvas viewer ───────────────────────
    {
      type: 'function',
      function: {
        name: 'present_file',
        description:
          'Open a workspace file in the canvas viewer so the user can see it. ' +
          'Use this to surface any file created by background agents, analysis tools, or other processes that ' +
          "don't automatically open the canvas. Accepts absolute or workspace-relative paths. " +
          'Common use: after deploy_analysis_team completes, call present_file({ path: reportPath }) to open the HTML report.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Absolute or workspace-relative path to the file to open in the canvas' },
          },
        },
      },
    },
    // ── dispatch_team_agent: run a subagent in a managed team ─────────────────
    {
      type: 'function',
      function: {
        name: 'dispatch_team_agent',
        description: 'Dispatch a subagent in a managed team to perform a task. By default runs synchronously (blocks until done). Set background=true to fire-and-forget — returns a task_id immediately so you can do other work while the agent runs, then call get_agent_result(task_id) when you need the result.',
        parameters: {
          type: 'object',
          required: ['team_id', 'agent_id', 'task'],
          properties: {
            team_id: { type: 'string', description: 'The team ID (e.g. "team_abc123_xyz")' },
            agent_id: { type: 'string', description: 'The ID of the agent to dispatch (must be a subagent member of the team)' },
            task: { type: 'string', description: 'Full task description for the agent to execute — be specific and include all needed context' },
            background: { type: 'boolean', description: 'If true, run agent in background and return { task_id } immediately. Use get_agent_result(task_id) to collect the result later. Default: false (blocks until done).' },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 300000 = 5 min)' },
          },
        },
      },
    },
    // ── request_team_member_turn: invite a member into the shared room ────────
    {
      type: 'function',
      function: {
        name: 'request_team_member_turn',
        description: 'Invite a managed-team member into the shared team room for planning, discussion, clarification, or readiness checks without starting an execution dispatch. The member uses their persistent room session and posts their reply into team chat. Use background=true to ask multiple members in parallel; when doing that, create an internal_watch(target.type="task") for each returned task_id so the coordinator/main chat resumes when answers are ready instead of polling.',
        parameters: {
          type: 'object',
          required: ['team_id', 'agent_id', 'prompt'],
          properties: {
            team_id: { type: 'string', description: 'The team ID (e.g. "team_abc123_xyz")' },
            agent_id: { type: 'string', description: 'The ID of the team member to invite into the room' },
            prompt: { type: 'string', description: 'What you want the member to think about, answer, or discuss in the team room' },
            background: { type: 'boolean', description: 'If true, start the member room turn in the background and return a task_id immediately. Default: false.' },
          },
        },
      },
    },
    // ── get_agent_result: collect result from a background-dispatched agent ───
    {
      type: 'function',
      function: {
        name: 'get_agent_result',
        description: 'Collect the result of an agent started with background=true. Works for dispatch_team_agent and request_team_member_turn. By default waits until the agent finishes (block=true). Pass block=false to check status without waiting — useful for polling.',
        parameters: {
          type: 'object',
          required: ['task_id'],
          properties: {
            task_id: { type: 'string', description: 'The task_id returned by dispatch_team_agent or request_team_member_turn when background=true' },
            block: { type: 'boolean', description: 'If true (default), wait until the agent finishes. If false, return current status immediately without blocking.' },
            timeout_ms: { type: 'number', description: 'Max wait time in ms when block=true (default: 300000 = 5 min). If the agent is still running after this, returns a "still running" message and you can call again.' },
          },
        },
      },
    },
    // ── post_to_team_chat: post a message to the shared team channel ──────────
    {
      type: 'function',
      function: {
        name: 'post_to_team_chat',
        description: 'Post a message to the team chat visible to all agents, the coordinator, and the team owner. Use this to share progress, ask another agent for help, or report findings mid-task.',
        parameters: {
          type: 'object',
          required: ['team_id', 'message'],
          properties: {
            team_id: { type: 'string', description: 'The team ID' },
            message: { type: 'string', description: 'Message to post (shown to all team members and coordinator)' },
          },
        },
      },
    },
    // ── message_main_agent: coordinator → main agent 2-way communication ────────
    {
      type: 'function',
      function: {
        name: 'message_main_agent',
        description: 'Send a message from the team coordinator to the main Prometheus agent. This creates a 2-way conversation thread visible in both the team chat and the main chat. Use this for: planning questions, error escalation, requesting decisions, or reporting status that the main agent needs to know about. When wait_for_reply is true, post [WAITING_MAIN_AGENT] in your response after calling this — the system will auto-resume your turn when the main agent replies.',
        parameters: {
          type: 'object',
          required: ['team_id', 'message'],
          properties: {
            team_id: { type: 'string', description: 'The team ID' },
            message: { type: 'string', description: 'Message to send to the main Prometheus agent. Be specific — include context about what you need and why.' },
            wait_for_reply: { type: 'boolean', description: 'If true (default), the coordinator will pause and wait for the main agent to reply before continuing. Set false for fire-and-forget status updates.' },
            message_type: { type: 'string', enum: ['planning', 'error', 'status'], description: 'Type of message: planning (need a decision), error (escalating a problem), status (FYI update). Default: planning.' },
          },
        },
      },
    },
    // ── reply_to_team: main agent → team coordinator reply ───────────────────
    {
      type: 'function',
      function: {
        name: 'reply_to_team',
        description: 'Reply to a team coordinator\'s message. Use this when a team has sent you (the main agent) a planning question, error report, or other message that needs a response. Your reply will appear in the team chat. Prefix with [BROADCAST_TO_TEAM] for the whole team, [ASK_AGENT:<agent id or name>] for one member, or [TO_MANAGER] for manager-only. If no member is named, default to [BROADCAST_TO_TEAM]. For team/member routes, the system delivers the message to the addressed member room turn(s) first, then resumes the coordinator after those responses settle.',
        parameters: {
          type: 'object',
          required: ['team_id', 'message'],
          properties: {
            team_id: { type: 'string', description: 'The team ID to reply to' },
            message: { type: 'string', description: 'Your reply to the coordinator. Be specific and actionable — the coordinator will use this to continue their work.' },
          },
        },
      },
    },
    // ── manage_team_goal: structured goal management for team coordinators ────
    {
      type: 'function',
      function: {
        name: 'manage_team_goal',
        description: 'Manage the team\'s structured goal system. Actions: set_focus (update what the team is working on NOW), set_mission (update the permanent mission), log_completed (record completed work), add_milestone (project teams only), update_milestone (mark milestones complete/blocked), pause_agent (pause an individual agent), unpause_agent (resume an agent).',
        parameters: {
          type: 'object',
          required: ['team_id', 'action'],
          properties: {
            team_id: { type: 'string', description: 'The team ID' },
            action: { type: 'string', enum: ['set_focus', 'update_focus', 'set_mission', 'log_completed', 'add_milestone', 'update_milestone', 'pause_agent', 'unpause_agent'], description: 'The goal management action to perform. update_focus is accepted as an alias for set_focus.' },
            value: { type: 'string', description: 'For set_focus/set_mission/log_completed: the text value' },
            milestone_id: { type: 'string', description: 'For update_milestone: the milestone ID to update' },
            milestone_description: { type: 'string', description: 'For add_milestone: description of the milestone' },
            milestone_status: { type: 'string', enum: ['pending', 'active', 'complete', 'blocked'], description: 'For add_milestone/update_milestone: the status' },
            agent_id: { type: 'string', description: 'For pause_agent/unpause_agent: which agent to pause/unpause' },
            relevant_agent_ids: { type: 'array', items: { type: 'string' }, description: 'For add_milestone: which agents are relevant to this milestone' },
            reason: { type: 'string', description: 'For pause_agent: why the agent is being paused' },
          },
        },
      },
    },
    // ── manage_team_context_ref: persistent team context/reference cards ───────
    {
      type: 'function',
      function: {
        name: 'manage_team_context_ref',
        description: 'Manage persistent team context/reference cards. These references are injected into the team manager and every subagent run. Use list before changing existing cards; preserve existing references unless the user explicitly asks to remove one.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['list', 'add', 'update', 'delete'], description: 'List, add, update, or delete persistent team context references.' },
            team_id: { type: 'string', description: 'Team ID. Optional for list to summarize all teams; required for add/update/delete.' },
            ref_id: { type: 'string', description: 'Reference ID. Required for update/delete.' },
            title: { type: 'string', description: 'Reference title. Required for add; optional replacement for update.' },
            content: { type: 'string', description: 'Reference content/body. Required for add; optional replacement for update. Include skill names, business context, links, or instructions agents should see on every run.' },
          },
        },
      },
    },
    // ── social_intel: social media intelligence tool (CIS Phase 3) ─────────────
    {
      type: 'function',
      function: {
        name: 'social_intel',
        description: 'Analyze a social media profile for a given platform and handle. Returns structured metrics, engagement analysis, growth trajectory, and content recommendations. Results are persisted to entities/social/[platform].md.',
        parameters: {
          type: 'object',
          required: ['platform', 'handle'],
          properties: {
            platform: { type: 'string', enum: ['instagram', 'tiktok', 'x', 'twitter', 'linkedin', 'facebook'], description: 'The social media platform to analyze' },
            handle: { type: 'string', description: 'The username or handle to analyze (with or without @)' },
            mode: { type: 'string', enum: ['full', 'quick'], description: 'Analysis depth: full (default) or quick summary' },
          },
        },
      },
    },
    // ── MCP / Integration Tools ───────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connection_ops',
        description: 'Preferred universal plugin-backed setup orchestrator. discover resolves a natural service name without creating an attempt; plan creates/reuses a durable attempt and returns approval/research state; connect starts an approved strategy; continue resumes user-assisted auth; verify is the only authority for claiming readiness. Credentials must use secure input, never chat arguments.',
        parameters: {
          type: 'object', required: ['action'],
          properties: {
            action: { type: 'string', enum: ['discover', 'plan', 'connect', 'continue', 'verify', 'repair', 'status', 'cancel', 'disconnect', 'list', 'list_connections'] },
            service: { type: 'string' }, service_id: { type: 'string' }, service_name: { type: 'string' },
            connection_attempt_id: { type: 'string' }, connection_id: { type: 'string' },
            detail: { type: 'string', enum: ['compact', 'full'], description: 'compact (default) returns bounded summaries; full returns complete canonical records.' },
            requested_capabilities: { type: 'array', items: { type: 'string' } }, read_only: { type: 'boolean' },
            approved: { type: 'boolean' }, metadata: { type: 'object' }, input: { type: 'object' },
          }, additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'webhook_manage',
        description: 'Manage core and provider webhook settings without exposing stored secrets. Actions: get, set, set_provider, test.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'Action: get | set | set_provider | test' },
            enabled: { type: 'boolean', description: 'Enable/disable webhook endpoint (set action)' },
            token: { type: 'string', description: 'Webhook auth token (set action)' },
            path: { type: 'string', description: 'Webhook base path, e.g. /hooks (set action)' },
            provider: { type: 'string', enum: ['github', 'stripe', 'slack'], description: 'Provider for set_provider or provider-specific test.' },
            secret: { type: 'string', description: 'Provider signing secret for set_provider. Stored in the vault and never returned.' },
            events: { type: 'object', description: 'Provider event-to-action map. Values: audit | wake | agent | ignore.' },
            deliver: { type: 'boolean', description: 'Allow configured provider agent results to be delivered to Telegram. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'mcp_server_manage',
        description: 'Advanced MCP administration/debug control plane. For normal user requests to set up or connect an MCP service, use connection_ops so identity resolution, durable cards, secure input, cross-device continuation, and verification are preserved.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'Action: list | status | upsert | import | connect | disconnect | delete | list_tools | start_enabled | oauth_start | oauth_status | oauth_clear' },
            id: { type: 'string', description: 'Server ID for connect/disconnect/delete/upsert' },
            name: { type: 'string', description: 'Human-readable server name (defaults to id)' },
            transport: { type: 'string', description: 'stdio, sse, or http (http is accepted as alias for streamable HTTP MCP)' },
            type: { type: 'string', description: 'Compatibility alias for transport (e.g. "http")' },
            enabled: { type: 'boolean', description: 'Whether this MCP server should be enabled' },
            command: { type: 'string', description: 'Command for stdio transport' },
            args: { type: 'array', items: { type: 'string' }, description: 'Arguments for stdio transport' },
            env: { type: 'object', description: 'Environment map for stdio transport' },
            url: { type: 'string', description: 'URL for sse/http transport' },
            headers: { type: 'object', description: 'Optional HTTP headers map' },
            description: { type: 'string', description: 'Optional server description' },
            config: { type: 'object', description: 'Full server config object (recommended for upsert)' },
            json: { description: 'JSON object or JSON string for import action. Supports {mcpServers:{...}} format.' },
            connect: { type: 'boolean', description: 'If true on upsert/import, attempt connection immediately' },
            confirm: { type: 'boolean', description: 'Required for delete action' },
            scope: { type: 'string', description: 'Optional OAuth scope for oauth_start.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'integration_quick_setup',
        description: 'Quick integration presets for common MCP services. Actions: list_presets, setup.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'Action: list_presets | setup' },
            preset: { type: 'string', description: 'Preset id: supabase, github, windows, brave, postgres, sqlite, filesystem, memory' },
            id: { type: 'string', description: 'Optional MCP server id override (defaults to preset)' },
            name: { type: 'string', description: 'Optional MCP server name override' },
            enabled: { type: 'boolean', description: 'Enable server config (default true)' },
            connect: { type: 'boolean', description: 'Connect immediately after saving (default true)' },
            project_ref: { type: 'string', description: 'Supabase project ref' },
            read_only: { type: 'boolean', description: 'Supabase read-only mode (default true)' },
            features: { type: 'array', items: { type: 'string' }, description: 'Supabase features list (e.g. database,docs)' },
            mode: { type: 'string', description: 'Supabase mode: safe (read-only) or write' },
            token: { type: 'string', description: 'Generic token field for presets that need one (e.g., GitHub token)' },
            github_token: { type: 'string', description: 'GitHub personal access token or vault ref' },
            brave_api_key: { type: 'string', description: 'Brave API key or vault ref' },
            connection_string: { type: 'string', description: 'Postgres connection string' },
            db_path: { type: 'string', description: 'SQLite database path' },
            root_path: { type: 'string', description: 'Filesystem root path' },
            windows_command: { type: 'string', description: 'Windows MCP command (default: uvx)' },
            windows_package: { type: 'string', description: 'Windows MCP package/module for windows_command (default: windows-mcp)' },
            windows_args: { type: 'array', items: { type: 'string' }, description: 'Extra args for windows MCP process' },
          },
        },
      },
    },
    // ── edit_proposal tool ────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'edit_proposal',
        description:
          'Update a pending proposal before approval. Supports title/summary/details/affected_files/diff preview updates and writes a new revision entry. Returns 404 if proposal is missing, 409 if proposal is no longer pending, and 400 when src-edit details validation fails.',
        parameters: {
          type: 'object',
          required: ['proposal_id'],
          properties: {
            proposal_id: { type: 'string', description: 'Proposal ID to edit (e.g. prop_123...)' },
            updates: {
              type: 'object',
              description: 'Fields to update on the pending proposal. Also accepts these fields at top-level for convenience.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['feature_addition', 'src_edit', 'config_change', 'task_trigger', 'memory_update', 'skill_evolution', 'prompt_mutation', 'general'],
                },
                execution_mode: {
                  type: 'string',
                  enum: ['code_change', 'action', 'general'],
                  description: 'Execution lane used after approval. general = read/research/audit + internal Prometheus orchestration (start a team, message a subagent), no user-file or external-world side effects. action = real work in the user\'s world (build/fix in the workspace or an allowed path, respond to an incoming email/webhook); requires a hardened "## Current state" section confirming the gap still exists. code_change = Prometheus\'s OWN src/ or web-ui/ self-edit only (sandboxed).',
                },
                priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                title: { type: 'string' },
                summary: { type: 'string' },
                details: { type: 'string' },
                affected_files: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      action: { type: 'string', enum: ['create', 'edit', 'delete'] },
                      description: { type: 'string' },
                    },
                  },
                },
                diff_preview: { type: 'string' },
                estimated_impact: { type: 'string' },
                requires_build: { type: 'boolean' },
                requires_src_edit: { type: 'boolean' },
                executor_agent_id: { type: 'string' },
                executor_prompt: { type: 'string' },
              },
            },
            edited_by: { type: 'string', description: 'Optional editor identifier for revision history.' },
            note: { type: 'string', description: 'Optional revision note.' },
          },
        },
      },
    },
    // ── switch_model tool ─────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'switch_model',
        description:
          'Switch the active LLM for the remainder of this turn only. Auto-reverts to the session\'s primary model after turn end — never switch back manually. ' +
          'Call EARLY (first or second tool call) when the task is clearly lightweight. ' +
          'LOW (speed): single command, file read/summary, quick lookup, write_note only, simple one-tool tasks. ' +
          'MEDIUM (careful): multi-step work that doesn\'t need the full primary model — analysis, moderate reasoning, structured writes. ' +
          'STAY ON PRIMARY: src/ edits, proposals, deep reasoning, auth/security/build system, anything that could go wrong expensively. ' +
          'BLOCKED in background/task execution sessions — only in interactive and Telegram turns.',
        parameters: {
          type: 'object',
          required: ['tier', 'reason'],
          properties: {
            tier: {
              type: 'string',
              enum: ['low', 'medium'],
              description: "'low' = speed model (fast, cheap — configured in Settings → Switch Model Fast). 'medium' = careful model (configured in Settings → Switch Model Careful).",
            },
            reason: {
              type: 'string',
              description: 'Brief reason shown to the user, e.g. "single file read" or "structured analysis, no src edits".',
            },
          },
        },
      },
    },
    // ── write_proposal tool ────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_agent_models',
        description:
          'Read the current model routing configuration: active/current primary model, per-slot model and reasoning defaults, and per-agent overrides. ' +
          'Use this before changing proposal executor, background, coordinator, switch_model, or subagent defaults.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_current_model',
        description:
          'Switch the current primary LLM provider/model for this live chat and persist it in .prometheus/config.json. ' +
          'Use this when the user asks to switch the current AI/model now, e.g. "switch over to Grok 4.3" or "make GPT-5.5 the current model". ' +
          'This updates llm.provider, llm.providers[provider].model, and models.primary; it is not an agent default/template change. ' +
          'The next model call in the current turn and future turns will use the new current model.',
        parameters: {
          type: 'object',
          required: ['model'],
          properties: {
            model: {
              type: 'string',
              description: 'Provider/model route in "provider/model" format, e.g. "xai/grok-4.3" or "openai_codex/gpt-5.5".',
            },
            reason: {
              type: 'string',
              description: 'Optional short reason shown in logs/UI, e.g. "user requested Grok".',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_agent_model',
        description:
          'Safely update provider, model, and reasoning routing in .prometheus/config.json without raw file writes. ' +
          'Use agent_type to update an allowlisted agent model route, including goal_compactor and goal_judge, or agent_id to update a specific configured agent override. ' +
          'Critical outage use: when proposals/background work are blocked by a provider quota event, set proposal_executor_low_risk, coordinator, or subagent_* defaults to a working provider/model such as openai_codex/gpt-5.5. ' +
          'Changes are persisted through the Settings API and take effect for new proposal executions, scheduled background tasks, direct background spawns, team agents, subagents, and model switches.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            provider: {
              type: 'string',
              description: 'Optional provider ID when model is supplied without a provider prefix, e.g. openai_codex.',
            },
            model: {
              type: 'string',
              description: 'Model name, or full provider/model route, e.g. "gpt-5.6-terra" with provider or "openai_codex/gpt-5.6-terra".',
            },
            reasoning_effort: {
              type: 'string',
              enum: ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
              description: 'Provider/model-aware reasoning effort. Empty string clears the override. May be updated without changing model.',
            },
            agent_type: {
              type: 'string',
              enum: [
                'main_chat',
                'proposal_executor_high_risk',
                'proposal_executor_low_risk',
                'manager',
                'team_manager',
                'subagent',
                'team_subagent',
                'subagent_planner',
                'subagent_orchestrator',
                'subagent_researcher',
                'subagent_analyst',
                'subagent_builder',
                'subagent_operator',
                'subagent_verifier',
                'switch_model_low',
                'switch_model_medium',
                'coordinator',
                'background_task',
                'background_spawn',
                'goal_compactor',
                'goal_judge',
              ],
              description: 'Allowlisted durable model route. goal_compactor and goal_judge update Session > Goal Support; other values update agent_model_defaults.',
            },
            agent_id: {
              type: 'string',
              description: 'Specific configured agent ID to update instead of a type-level default.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_agent_model_templates',
        description:
          'List saved named agent model default templates, the active template id, and current agent_model_defaults. ' +
          'Use this before applying, modifying, or removing a saved model routing template.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_agent_model_template',
        description:
          'Create or update a named template snapshot for agent model and reasoning defaults. ' +
          'If defaults is omitted, the current live defaults are saved. Use id or an existing name to modify a saved template. ' +
          'This only saves the template; use select_agent_model_template/apply_agent_model_template to make it live.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            id: {
              type: 'string',
              description: 'Optional template id to update.',
            },
            name: {
              type: 'string',
              description: 'Custom template name, e.g. "Default 1" or "Research-heavy".',
            },
            defaults: {
              type: 'object',
              description: 'Optional full agent_model_defaults map to save. Values use "provider/model"; omit to snapshot current defaults.',
              additionalProperties: { type: 'string' },
            },
            reasoning: {
              type: 'object',
              description: 'Optional per-slot reasoning effort map keyed like defaults.',
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_agent_model_template',
        description:
          'Modify an existing agent model default template by id or exact name without applying it. ' +
          'Use this to rename a template or replace its saved model/reasoning defaults without applying it.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Template id or exact template name to modify.',
            },
            name: {
              type: 'string',
              description: 'Optional new template display name.',
            },
            defaults: {
              type: 'object',
              description: 'Optional replacement agent_model_defaults map. Values use "provider/model"; omit to rename only.',
              additionalProperties: { type: 'string' },
            },
            reasoning: {
              type: 'object',
              description: 'Optional replacement per-slot reasoning effort map.',
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_agent_model_template',
        description:
          'Apply a saved agent model default template by id or exact name. This replaces current agent_model_defaults and persists through gateway restarts.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Template id or exact template name.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'select_agent_model_template',
        description:
          'Select and apply a saved agent model default template by id or exact name. Alias for apply_agent_model_template, named for on-the-fly template switching.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Template id or exact template name.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_agent_model_template',
        description:
          'Remove a saved agent model default template by id or exact name. This does not change the currently applied agent_model_defaults.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Template id or exact template name.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_prometheus_questions',
        description:
          'Ask the user 1-5 structured questions as a durable interactive card. This call blocks and the current turn remains suspended until the user answers or cancels the card; do not send a follow-up message while it is pending. Use when a missing decision/preference materially affects the next step.',
        parameters: {
          type: 'object',
          required: ['title', 'prompt', 'questions'],
          properties: {
            title: { type: 'string', description: 'Short card title shown to the user, max ~180 chars.' },
            prompt: { type: 'string', description: 'Warm concise explanation of why Prometheus needs this answer.' },
            context: { type: 'string', description: 'Optional short context about the task or decision.' },
            allow_general_other: { type: 'boolean', description: 'Whether to show an extra Anything else field for the whole card. Defaults true.' },
            questions: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: {
                type: 'object',
                required: ['id', 'label', 'mode'],
                properties: {
                  id: { type: 'string', description: 'Stable snake_case answer key.' },
                  label: { type: 'string', description: 'The user-facing question.' },
                  mode: { type: 'string', enum: ['single_select', 'multi_select', 'text'], description: 'single_select for one choice, multi_select for several, text for open-ended.' },
                  options: { type: 'array', items: { type: 'string' }, description: '2-8 concise options for select questions. Not needed for text questions.' },
                  allowOther: { type: 'boolean', description: 'Whether this question has an Other option/text. Defaults true.' },
                  required: { type: 'boolean', description: 'Whether an answer is needed before submit. Defaults true.' },
                  helpText: { type: 'string', description: 'Optional tiny helper text.' },
                },
              },
            },
            ttl_ms: { type: 'number', description: 'Optional expiry in milliseconds. Defaults to several hours.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'await_prometheus_question_response',
        description:
          'Resume waiting for a pending Prometheus Question after handling a steer/interruption. ' +
          'Returns immediately if the question was already answered. Use only with a question_id returned by ask_prometheus_questions.',
        parameters: {
          type: 'object',
          required: ['question_id'],
          properties: {
            question_id: { type: 'string', description: 'The Prometheus Question ID to resume waiting for.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_final_action_approval',
        description:
          'Ask the user for one-shot approval before triggering a high-impact final UI action such as Post, Send, Publish, Submit, Purchase, Transfer, Delete, or Checkout. ' +
          'Use after preparing the UI with browser/desktop tools and before the final click or Enter key. If approved, pass the returned final_action_approval_id to the exact next browser_click/browser_press_key/desktop_click/desktop_press_key call. ' +
          'That approved final action automatically returns post-action visual evidence; inspect it and confirm the approved action succeeded before reporting completion.',
        parameters: {
          type: 'object',
          required: ['action_kind', 'target_label', 'summary'],
          properties: {
            action_kind: { type: 'string', enum: ['post', 'send', 'publish', 'submit', 'purchase', 'delete', 'transfer', 'other'], description: 'The final action category.' },
            target_label: { type: 'string', description: 'Visible button/menu label or concise target name, e.g. "Post", "Send", "Publish", "Delete repository".' },
            summary: { type: 'string', description: 'User-facing summary of exactly what will happen if approved, including content/account/recipient when relevant.' },
            surface: { type: 'string', description: 'App/site/window/account context, e.g. "X in Chrome" or "Slack desktop".' },
            next_tool_name: { type: 'string', enum: ['browser_click', 'browser_press_key', 'desktop_click', 'desktop_press_key'], description: 'Exact next tool that will consume the one-shot approval.' },
            next_tool_args: { type: 'object', description: 'Optional subset of the exact next tool args to bind this approval to, excluding final_action_approval_id.' },
            screenshot_id: { type: 'string', description: 'Optional screenshot_id for the prepared UI state.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_dev_source_edit',
        description:
          'Request dev-only scoped approval to edit listed Prometheus src/web-ui files in this chat. Only files and a short reason are required; include a concise plan/evidence only when it clarifies risk or scope.',
        parameters: {
          type: 'object',
          required: ['files', 'reason'],
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Project-relative src/ or web-ui/ file paths to unlock, e.g. ["src/gateway/routes/chat.router.ts"].',
            },
            reason: { type: 'string', description: 'Short user-facing reason for the edit request.' },
            plan: {
              type: 'object',
              description: 'Optional concise dev-edit plan. Omit for straightforward scoped edits; Prometheus will use safe defaults.',
              properties: {
                user_request: { type: 'string', description: 'What the user asked Prometheus to change.' },
                reasoning: { type: 'string', description: 'Why these files and this approach are appropriate.' },
                evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      file: { type: 'string' },
                      lines: { type: 'string' },
                      finding: { type: 'string' },
                    },
                  },
                  description: 'Optional observed file/line evidence for non-trivial edits.',
                },
                current_state: { type: 'string', description: 'What the code currently does.' },
                fix: { type: 'string', description: 'What will be changed.' },
                steps: { type: 'array', items: { type: 'string' }, description: 'Optional 2-5 execution steps for non-trivial edits.' },
                verification: { type: 'array', items: { type: 'string' }, description: 'Verification commands/checks to run.' },
                expected_workflow: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional workflow notes. Omit for ordinary scoped edits.',
                },
                completion_note_tag: { type: 'string', description: 'Tag to write with write_note after apply/restart. Default dev_edit_complete.' },
              },
            },
            verification_profile: {
              type: 'string',
              enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'],
              description: 'Optional safe verification profile. Prefer verification_profiles for composite checks. backend_build for backend/src, webui_sync_check for web-ui/mobile/static, full_build for runtime-wide changes, route_smoke/desktop_ui_smoke/mobile_ui_smoke for smoke checks, none when no build is needed.',
            },
            verification_profiles: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'],
              },
              description: 'Optional composite safe verification profiles. Prometheus also auto-narrows from affected_files when omitted.',
            },
            verification_command: { type: 'string', description: 'Legacy optional exact verification command. Prefer verification_profiles for Prometheus dev source edits.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_dev_source_edit',
        description:
          'Update a pending dev source edit approval (before the user approves or denies it). ' +
          'Use this after receiving a steer interrupt during an approval wait — revise the plan, reason, files, or steps to reflect the steer, then call await_dev_source_edit_approval to resume waiting. ' +
          'Only works on pending approvals in the current session.',
        parameters: {
          type: 'object',
          required: ['approval_id'],
          properties: {
            approval_id: { type: 'string', description: 'The approval ID returned by request_dev_source_edit or from the steer-interrupt result.' },
            reason: { type: 'string', description: 'Updated short reason for the edit request.' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Updated list of project-relative src/ or web-ui/ file paths.',
            },
            plan: {
              type: 'object',
              description: 'Partial plan update — only provided fields are merged in.',
              properties: {
                user_request: { type: 'string' },
                reasoning: { type: 'string' },
                current_state: { type: 'string' },
                fix: { type: 'string' },
                steps: { type: 'array', items: { type: 'string' } },
                verification: { type: 'array', items: { type: 'string' } },
                completion_note_tag: { type: 'string' },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'await_dev_source_edit_approval',
        description:
          'Resume waiting for a pending dev source edit approval after a steer interrupt. ' +
          'Call this after handling a steer (and optionally calling update_dev_source_edit) to re-enter the steer-interruptible wait. ' +
          'Returns immediately if the approval was already resolved. Can be interrupted again by another steer.',
        parameters: {
          type: 'object',
          required: ['approval_id'],
          properties: {
            approval_id: { type: 'string', description: 'The approval ID to resume waiting for.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_proposal',
	        description:
	          'Submit a human-approved proposal. Choose one execution_mode: general (read/research/internal orchestration), action (user-world work), or code_change (Prometheus src/web-ui self-edit). Include execution_steps for executable proposals.',
        parameters: {
          type: 'object',
          required: ['type', 'title', 'summary', 'details'],
          properties: {
            type: {
              type: 'string',
              enum: ['feature_addition', 'src_edit', 'config_change', 'task_trigger', 'memory_update', 'skill_evolution', 'prompt_mutation', 'general'],
              description: 'Category of change',
            },
            execution_mode: {
              type: 'string',
              enum: ['code_change', 'action', 'general'],
              description: 'Execution lane. general = read/research/audit + internal Prometheus orchestration (start a team, message a subagent), no user-file/external side effects. action = real work in the user\'s world (build/fix in the workspace or an allowed path, respond to an incoming email/webhook); requires a "## Current state" section confirming the gap still exists. code_change = Prometheus\'s OWN src/ or web-ui/ self-edit only (sandboxed). Editing a user project is action, never code_change.',
            },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'How urgent (default: medium)' },
            title: { type: 'string', description: 'Short title shown in the proposals panel (max 120 chars)' },
            summary: { type: 'string', description: '1-3 sentence summary of what will change and why (shown in notification)' },
            details: {
              type: 'string',
              description:
                'Full implementation details, markdown. Include execution_steps separately for the executor checklist. When affected_files includes any src/ path, you MUST include these exact headings and content: "Why this change", "Exact source edits", "Deterministic behavior after patch", "Acceptance tests", "Risks and compatibility". Otherwise the proposal will be rejected.',
            },
            affected_files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  action: { type: 'string', enum: ['create', 'edit', 'delete'] },
                  description: { type: 'string' },
                },
              },
              description: 'Files that will be created/edited/deleted',
            },
            execution_steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short approved task step title' },
                  kind: {
                    type: 'string',
                    enum: ['inspect', 'edit', 'write_artifact', 'trigger', 'verify', 'build', 'complete', 'other'],
                    description: 'What kind of work this step represents',
                  },
                  description: { type: 'string', description: 'Optional details for how to execute this step' },
                  success_criteria: { type: 'string', description: 'Optional concrete completion condition' },
                },
              },
              description: 'Approved executor checklist. Required for executable proposals; use 3-7 concrete steps. Dispatcher uses these as the task plan after approval and the executor must not call declare_plan.',
            },
            diff_preview: { type: 'string', description: 'Optional: code diff or before/after snippet' },
            estimated_impact: { type: 'string', description: 'e.g. "adds browser caching, reduces API calls by ~40%"' },
            requires_build: { type: 'boolean', description: 'True if src/ TypeScript changes need npm run build' },
	            executor_agent_id: { type: 'string', description: 'Which agent should execute this when approved. Required for team manager proposals and must be a member of that team.' },
            executor_prompt: { type: 'string', description: 'Exact prompt to send the executor agent when approved' },
            risk_tier: {
              type: 'string',
              enum: ['low', 'high'],
              description: "Execution model assignment. 'low' uses Settings > Agent Model Defaults > proposal_executor_low_risk for small isolated changes. 'high' uses proposal_executor_high_risk for core logic, auth, multi-file, build, or uncertain changes. Omit only when no risk-specific executor is needed.",
            },
          },
        },
      },
    },
    // ── prom_apply_dev_changes: smart dev sync/build/restart/reload ─────────────
    {
      type: 'function',
      function: {
        name: 'prom_apply_dev_changes',
        description:
          'Smart dev-only helper that makes Prometheus code/UI edits live. Use after applying approved source or web-ui/mobile changes. ' +
          'apply_live is a coordination readiness boundary: when other active edits or overlapping-file successors exist, it queues this edit without restarting, hands verified files to the next queued editor, and deploys only after the shared batch is ready. ' +
          'For web-ui/mobile changes it runs npm run sync:web-ui and requests connected web/mobile UI reload. ' +
          'For backend/src/gateway changes it runs the build and gracefully restarts the gateway. ' +
          'For mixed backend + web-ui/mobile changes it syncs web-ui first, then builds/restarts, then the restarted gateway asks connected desktop and mobile UI clients to reload. ' +
          'Use this instead of manually remembering sync/build/restart/reload steps during local dev/proposal execution.',
        parameters: {
          type: 'object',
          required: ['reason'],
          properties: {
            changed_surfaces: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['backend', 'src', 'gateway', 'web-ui', 'mobile', 'config', 'static'],
              },
              description: 'Changed areas. backend/src/gateway/config trigger build+restart; web-ui/mobile/static trigger sync:web-ui and connected web/mobile reload.',
            },
            verification_profile: {
              type: 'string',
              enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'],
              description: 'Optional manual verification profile override for verify_only. Usually omit this and provide affected_files so Prometheus can auto-narrow.',
            },
            verification_profiles: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'],
              },
              description: 'Optional manual composite verification profile override for verify_only. Usually omit this and provide affected_files so Prometheus can auto-narrow.',
            },
            mode: {
              type: 'string',
              enum: ['apply_live', 'verify_only'],
              description: 'apply_live (default) marks this verified edit ready for the shared batch and syncs/builds/restarts/reloads only when elected batch leader. verify_only records verification against exact current file hashes and does not restart the gateway.',
            },
            reason: { type: 'string', description: 'Why these changes are being applied live.' },
            proposal_id: { type: 'string', description: 'Proposal ID if this is proposal execution.' },
            dev_edit_id: { type: 'string', description: 'Dev edit id from request_dev_source_edit. Usually inferred from the current approved session.' },
            completion_note_tag: { type: 'string', description: 'Completion note tag for dev edit continuation. Defaults to dev_edit_complete or the approved plan value.' },
            title: { type: 'string', description: 'Human-readable title for restart/reload context.' },
            summary: { type: 'string', description: 'Brief description of what changed.' },
            affected_files: { type: 'array', items: { type: 'string' }, description: 'Changed file paths.' },
            refresh_desktop: { type: 'boolean', description: 'Whether to reload connected desktop and mobile web UI clients. Defaults true. Legacy name kept for compatibility.' },
            test_instructions: { type: 'string', description: 'What to verify after restart/reload.' },
          },
        },
      },
    },
    // ── gateway_restart: quick graceful restart ────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'gateway_restart',
        description:
          'Quickly and gracefully restart the gateway without running npm build. Use when the user asks to restart Prometheus/the gateway, ' +
          'matching the quick restart flow offered by Telegram, mobile, and the /restart menu. ' +
          'For source code changes that require build/sync, use prom_apply_dev_changes instead. ' +
          'The new process boots with a hot-restart context so it knows what changed. ' +
          'WARNING: This kills the current process. Only call this as your LAST action.',
        parameters: {
          type: 'object', required: ['reason'],
          properties: {
            reason: { type: 'string', description: 'Why the restart is needed (e.g. "Applied proposal #abc123")' },
            proposal_id: { type: 'string', description: 'Proposal ID if this is a proposal execution' },
            repair_id: { type: 'string', description: 'Repair ID if this is a self-repair' },
            title: { type: 'string', description: 'Human-readable title of the change' },
            summary: { type: 'string', description: 'Brief description of what was changed' },
            affected_files: { type: 'array', items: { type: 'string' }, description: 'List of changed file paths' },
            restart_scope: {
              type: 'string',
              enum: ['gateway', 'supervisor'],
              description: 'Default gateway replaces only the gateway child. Use supervisor when long-lived CLI/supervisor code changed; affected src/cli files select this automatically.',
            },
            full_supervisor: { type: 'boolean', description: 'Compatibility alias for restart_scope:"supervisor".' },
            test_instructions: { type: 'string', description: 'What to verify after restart' },
          },
        },
      },
    },
    // ── prom_repo_ops: unified Prometheus repo sync wrapper ───────────────────
    {
      type: 'function',
      function: {
        name: 'prom_repo_ops',
        description:
          'Dev-only asynchronous Prometheus repo sync wrapper. Use action:"push" to safely stage eligible changes, scan, commit, and push; action:"pull" to bring down remote changes; or action:"sync" for commit → merge → push. Omit message for a truly read-only preview that does not touch the Git index. Mutations use a cross-process repo lock and stable-snapshot staging.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['push', 'pull', 'sync'],
              description: 'Repo operation to run.',
            },
            message: {
              type: 'string',
              description: 'Commit message for push/sync. Omit first to receive the diff so you can author an accurate message. Multi-line allowed.',
            },
            set_pat: {
              type: 'string',
              description: 'Optional GitHub PAT to save locally for future repo syncs after an auth failure. Saved to this machine config only; never committed.',
            },
          },
        },
      },
    },
    // ── prom_repo_push: commit + push the Prometheus repo (dev sync) ───────────
    {
      type: 'function',
      function: {
        name: 'prom_repo_push',
        description:
          'Dev-only asynchronous repo checkpoint: safely stage sync-eligible Prometheus changes, run secret/large-file and diff checks, commit, and push. Omit message for a read-only preview that does not modify the Git index. Uses a cross-process lock and supports set_pat for auth recovery.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            message: { type: 'string', description: 'Commit message. Omit to first receive the diff so you can author an accurate message. Multi-line allowed (first line is the summary).' },
            set_pat: { type: 'string', description: 'Optional GitHub PAT (repo scope) to save locally for future pushes/pulls. Saved to the Prometheus config dir on this machine only — never committed to the repo. Provide this after the user hands you a PAT following an auth failure.' },
          },
        },
      },
    },
    // ── prom_repo_pull: pull latest of the Prometheus repo (dev sync) ──────────
    {
      type: 'function',
      function: {
        name: 'prom_repo_pull',
        description:
          'Dev-only asynchronous git pull --no-edit for the Prometheus repo, serialized through the repo-sync lock. Use to bring down edits from another machine. Does not rebuild/restart; use prom_apply_dev_changes after source/UI changes.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    // ── prom_repo_sync: safe two-way sync (commit → merge → push) ─────────────
    {
      type: 'function',
      function: {
        name: 'prom_repo_sync',
        description:
          'Dev-only asynchronous two-way sync: lock, stage a stable eligible snapshot, scan, commit, pull/merge origin, then push. Omit message for a read-only preview. If conflicts occur, no push happens and the local commit remains safe. Does not rebuild/restart.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            message: { type: 'string', description: 'Commit message for THIS machine\'s local changes. Omit to first receive the diff so you can author an accurate message.' },
            set_pat: { type: 'string', description: 'Optional GitHub PAT to save locally for future syncs (config dir only, never committed).' },
          },
        },
      },
    },
    // ── request_tool_category: activate on-demand tool category ─────────────
    {
      type: 'function',
      function: {
        name: 'request_tool_category',
        description: requestToolCategoryDescription,
        parameters: {
          type: 'object',
          required: ['category'],
          properties: {
            category: {
              type: 'string',
              enum: categoryEnum,
              description: 'Category to activate',
            },
            scope: {
              type: 'string',
              enum: ['turn', 'next_turn', 'ttl', 'session'],
              description: 'Activation lifetime. Defaults to turn. Use session only for explicit ongoing workflows.',
            },
            turns: {
              type: 'integer',
              minimum: 1,
              maximum: 12,
              description: 'When scope is ttl, number of user turns to keep this category active.',
            },
          },
        },
      },
    },
    // ── Skill Tools ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'business_context_mode',
        description:
          'Control automatic BUSINESS.md runtime injection for this session. ' +
          'Use enable when ongoing work needs persistent business/company context across later turns. ' +
          'Use disable to save context budget when that context is no longer needed. ' +
          'Use status to check whether BUSINESS.md auto-injection is currently on. ' +
          'When enabling, the tool also returns the current BUSINESS.md snapshot immediately so it can be used in the same turn.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['enable', 'disable', 'status'],
              description: 'Whether to enable, disable, or inspect BUSINESS.md auto-injection for this session.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_entities',
        description:
          'List structured business entity files under workspace/entities. ' +
          'Use to discover clients, projects, vendors, contacts, or social records before reading/updating them.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            type: {
              type: 'string',
              enum: ['client', 'project', 'vendor', 'contact', 'social'],
              description: 'Optional entity type filter.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_entity',
        description:
          'Read one business entity markdown file from workspace/entities/[type] by slug id. ' +
          'Use before updating a client, project, vendor, contact, or social entity.',
        parameters: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: { type: 'string', enum: ['client', 'project', 'vendor', 'contact', 'social'] },
            id: { type: 'string', description: 'Entity slug or name, e.g. acme-corp.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_entity',
        description:
          'Create or replace one structured business entity markdown file. ' +
          'Use for high-confidence business facts only; prefer append_entity_event for dated activity/history.',
        parameters: {
          type: 'object',
          required: ['type', 'id', 'content'],
          properties: {
            type: { type: 'string', enum: ['client', 'project', 'vendor', 'contact', 'social'] },
            id: { type: 'string', description: 'Entity slug or name, e.g. acme-corp.' },
            content: { type: 'string', description: 'Complete markdown content for the entity file.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'append_entity_event',
        description:
          'Ensure a business entity exists, then append a dated event/note to its Business Events section. ' +
          'Best for Brain Dream reconciliation, team runs, client/prospect interactions, project events, vendor updates, and social account milestones.',
        parameters: {
          type: 'object',
          required: ['type', 'id', 'event'],
          properties: {
            type: { type: 'string', enum: ['client', 'project', 'vendor', 'contact', 'social'] },
            id: { type: 'string', description: 'Entity slug or name, e.g. acme-corp.' },
            event: { type: 'string', description: 'One concise dated event to append.' },
            display_name: { type: 'string', description: 'Optional display name for newly created entities.' },
            source: { type: 'string', description: 'Optional evidence/source reference.' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional confidence label.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_list',
        description: 'Compact skill discovery. Natural task-style queries are ranked across id/name/description/triggers/categories/requiredTools with weak candidates instead of brittle exact matching. Descriptions are omitted unless include_descriptions:true is explicitly needed.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string', description: 'Optional natural language task/query to rank against skill metadata.' },
            limit: { type: 'number', description: 'Maximum skills to return. Default 24, hard cap 80.' },
            include_descriptions: { type: 'boolean', description: 'Include short descriptions. Default false to keep prompt usage low.' },
            include_match_details: { type: 'boolean', description: 'Include matched terms/fields for trigger debugging. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_read',
        description:
          'Read the full SKILL.md content of a skill by its ID. ' +
          'Always use this instead of read_file("skills/...") — it resolves the correct path ' +
          'regardless of which workspace context you are running in (main, team, subagent). ' +
          'Call skill_list first to get available IDs.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill ID from skill_list, e.g. "web-researcher" or "report-generator"' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_ops',
        description:
          'Unified skill maintenance wrapper. Requires the skills category. Use for skill inspection, bundled resources, imports/exports, metadata/manifest updates, source refreshes, creation, and fleet metadata audits/repairs. skill_list and skill_read remain the only core skill tools.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: [
                'inspect',
                'resource_list',
                'resource_read',
                'resource_write',
                'resource_delete',
                'update_metadata',
                'manifest_write',
                'import_bundle',
                'export_bundle',
                'update_from_source',
                'create',
                'create_bundle',
                'audit_all',
                'repair_metadata',
              ],
              description: 'Maintenance operation to run.',
            },
            id: { type: 'string', description: 'Skill ID for operations that target one skill.' },
            path: { type: 'string', description: 'Resource path for resource_read/write/delete.' },
            max_chars: { type: 'number', description: 'Optional cap for resource_read.' },
            content: { type: 'string', description: 'Text content for resource_write.' },
            source: { type: 'string', description: 'Directory, zip path, GitHub tree URL, or HTTPS zip URL for import_bundle.' },
            outputPath: { type: 'string', description: 'Optional output zip path for export_bundle.' },
            manifest: { type: 'object', description: 'Manifest overlay object for manifest_write.' },
            name: { type: 'string', description: 'Human-readable skill name for create/create_bundle or metadata updates.' },
            description: { type: 'string', description: 'Skill description or resource description.' },
            instructions: { type: 'string', description: 'Full SKILL.md instructions for create/create_bundle.' },
            version: { type: 'string', description: 'Optional version for create_bundle.' },
            triggers: { type: 'string', description: 'Comma-separated or JSON-array trigger phrases. Trigger changes require triggerPositivePrompts and triggerNegativePrompts.' },
            addTriggers: { type: 'string', description: 'Triggers to append during update_metadata. Requires triggerPositivePrompts and triggerNegativePrompts.' },
            removeTriggers: { type: 'string', description: 'Triggers to remove during update_metadata. Requires triggerPositivePrompts and triggerNegativePrompts.' },
            triggerPositivePrompts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required when create/create_bundle supplies triggers or update_metadata/manifest_write/repair_metadata changes triggers. Prompts that must rank the skill first with high confidence.',
            },
            triggerNegativePrompts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required when create/create_bundle supplies triggers or update_metadata/manifest_write/repair_metadata changes triggers. Unrelated prompts that must not route to the skill.',
            },
            implicitInvocation: { type: 'boolean', description: 'Set false for explicit-only skills that must not be implicitly routed.' },
            categories: { type: 'string', description: 'Comma-separated categories.' },
            requiredTools: { type: 'string', description: 'Comma-separated required tool/category names.' },
            lifecycle: { type: 'string', description: 'Lifecycle state for update_metadata.' },
            permissions: { type: 'object', description: 'Permission hints for create_bundle.' },
            resources: { type: 'array', items: { type: 'object' }, description: 'Optional resource objects for create_bundle.' },
            type: { type: 'string', description: 'Resource type for resource_write.' },
            overwrite: { type: 'boolean', description: 'Overwrite existing imported/created skill where supported.' },
            addToManifest: { type: 'boolean', description: 'For resource_write, add/update the resource in skill.json. Default true.' },
            removeFromManifest: { type: 'boolean', description: 'For resource_delete, remove the resource from skill.json. Default true.' },
            changeType: { type: 'string', description: 'Optional ledger change type.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence refs for the skill change ledger.' },
            appliedBy: { type: 'string', description: 'Optional actor label for the skill change ledger.' },
            reason: { type: 'string', description: 'Optional short rationale for updates.' },
            scope: { type: 'string', description: 'Audit/repair scope: all, prometheus-related, or substring.' },
            onlyProblems: { type: 'boolean', description: 'For audit_all, return only flagged skills. Default true.' },
            threshold: { type: 'number', description: 'Audit/repair score threshold. Default 80.' },
            mode: { type: 'string', enum: ['preview', 'apply'], description: 'For repair_metadata. Default preview.' },
            ids: { type: 'string', description: 'Comma-separated skill IDs for repair_metadata preview.' },
            confirm: { type: 'boolean', description: 'Required true for repair_metadata apply.' },
            repairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  triggers: { type: 'string' },
                  categories: { type: 'string' },
                  requiredTools: { type: 'string' },
                  lifecycle: { type: 'string' },
                  name: { type: 'string' },
                  implicitInvocation: { type: 'boolean' },
                  triggerPositivePrompts: { type: 'array', items: { type: 'string' } },
                  triggerNegativePrompts: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Repair entries for repair_metadata apply. Entries that change triggers require positive and negative evaluation prompts.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_list',
        description:
          'List static resources bundled with a skill, such as templates, schemas, examples, docs, and assets. ' +
          'Use after skill_read when the skill instructions mention bundled resources.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill ID from skill_list.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_read',
        description:
          'Read a text resource from inside a bundled skill. Paths are scoped to the skill folder; absolute paths and ../ traversal are rejected. ' +
          'Only text-like resource types are readable in V1; scripts are never executed.',
        parameters: {
          type: 'object',
          required: ['id', 'path'],
          properties: {
            id: { type: 'string', description: 'Skill ID from skill_list.' },
            path: { type: 'string', description: 'Resource path from skill_resource_list, e.g. "templates/lead-report.md".' },
            max_chars: { type: 'number', description: 'Optional explicit cap; omit to return the full resource.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_import_bundle',
        description:
          'Install a downloaded bundled skill from a local directory, local .zip file, or HTTPS URL to a .zip. ' +
          'A GitHub tree URL such as https://github.com/owner/repo/tree/main/skills is also supported and may import multiple skills. ' +
          'The bundle must contain skill.json or SKILL.md. This imports static resources only; no bundled scripts are executed.',
        parameters: {
          type: 'object',
          required: ['source'],
          properties: {
            source: { type: 'string', description: 'Directory path, .zip path, GitHub tree URL, or https URL to a .zip skill bundle.' },
            id: { type: 'string', description: 'Optional override ID to install as. Only valid for a single skill bundle.' },
            overwrite: { type: 'boolean', description: 'Replace an existing skill with the same ID. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_inspect',
        description:
          'Inspect the normalized metadata for a skill, including native/overlay manifest source, provenance, resources, validation, required tools, categories, and permissions.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill ID from skill_list.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_curator',
        description:
          'Inspect or run the Brain Skill Curator. Runs default to dry-run. Applying a pending suggestion is the only autonomous-system path that may mutate a skill.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['status', 'run', 'apply', 'reject'] },
            mode: { type: 'string', enum: ['dry-run', 'pending', 'auto-safe'], description: 'For action=run. Defaults to dry-run; auto-safe is currently mutation-frozen.' },
            id: { type: 'string', description: 'Suggestion id for apply/reject.' },
            limit: { type: 'number', description: 'For status. Compact rows to return; defaults to 5, maximum 100.' },
            cursor: { type: 'number', description: 'For status pagination. Zero-based offset.' },
            statusFilter: { type: 'string', description: 'For status. Restrict to one suggestion status.' },
            skillId: { type: 'string', description: 'For status. Restrict to one skill id.' },
            includeContent: { type: 'boolean', description: 'For status. Include full suggestion bodies; defaults false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_candidate_submit',
        description:
          'Submit a structured, candidate-only skill improvement for Brain Curator review. This never changes skill files. ' +
          'Use it from Thought, Dream, cleanup, or normal workflows instead of autonomously creating or updating a skill.',
        parameters: {
          type: 'object',
          required: ['type', 'reason', 'suggestedAction'],
          properties: {
            type: {
              type: 'string',
              enum: ['update_existing_skill', 'add_resource_or_template', 'add_trigger', 'create_new_skill_candidate'],
            },
            skillId: { type: 'string', description: 'Required for existing-skill, resource, and trigger candidates.' },
            resourcePath: { type: 'string', description: 'Optional proposed resource path; Curator may replace it.' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            reason: { type: 'string', description: 'Observed evidence-backed gap or repeated workflow.' },
            suggestedAction: { type: 'string', description: 'Candidate action for Curator review, not an instruction to mutate immediately.' },
            requestExcerpt: { type: 'string', description: 'Optional user-authored excerpt. Do not put assistant-authored approval here.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative evidence references.' },
            submittedBy: { type: 'string', description: 'Actor label such as brain_thought or brain_dream.' },
            triggerPositivePrompts: { type: 'array', items: { type: 'string' }, description: 'Required for add_trigger: prompts that should route to the target skill.' },
            triggerNegativePrompts: { type: 'array', items: { type: 'string' }, description: 'Required for add_trigger: unrelated prompts that must not route to the target skill.' },
            proposedTrigger: { type: 'string', description: 'Required for add_trigger: the exact multiword trigger phrase to evaluate.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_manifest_write',
        description:
          'Write a Prometheus-owned manifest overlay for an installed skill without modifying the downloaded skill folder. ' +
          'Use to enrich third-party skills with version, triggers, categories, required tools, permissions, and curated resources.',
        parameters: {
          type: 'object',
          required: ['id', 'manifest'],
          properties: {
            id: { type: 'string', description: 'Installed skill ID.' },
            manifest: {
              type: 'object',
              description: 'Manifest overlay object. Prometheus normalizes id and defaults schemaVersion/entrypoint.',
            },
            changeType: { type: 'string', description: 'Optional ledger change type, e.g. trigger_addition or lifecycle_update.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence refs for the skill change ledger.' },
            appliedBy: { type: 'string', description: 'Optional actor label. Brain auto-updates should use brain_dream.' },
            reason: { type: 'string', description: 'Optional short rationale for the ledger.' },
            triggerPositivePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers change: prompts that must rank this skill first with high confidence.' },
            triggerNegativePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers change: unrelated prompts that must not suggest this skill.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_create_bundle',
        description:
          'Create a first-class bundled skill with skill.json, SKILL.md, optional resources, categories, required tools, and permissions. ' +
          'Use this for reusable workflows that need templates, schemas, examples, references, or richer metadata.',
        parameters: {
          type: 'object',
          required: ['id', 'name', 'instructions'],
          properties: {
            id: { type: 'string', description: 'Unique kebab-case skill ID.' },
            name: { type: 'string', description: 'Human-readable skill name.' },
            description: { type: 'string', description: 'One-sentence summary.' },
            instructions: { type: 'string', description: 'Full SKILL.md instructions.' },
            version: { type: 'string', description: 'Version string. Default 1.0.0.' },
            triggers: { type: 'string', description: 'Comma-separated trigger phrases.' },
            triggerPositivePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers are provided.' },
            triggerNegativePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers are provided.' },
            categories: { type: 'string', description: 'Comma-separated categories.' },
            requiredTools: { type: 'string', description: 'Comma-separated required tool/category names.' },
            permissions: { type: 'object', description: 'Permission hints such as browser, workspaceRead, workspaceWrite, shell, externalSideEffects.' },
            implicitInvocation: { type: 'boolean', description: 'Default true. Set false for broad, role, style, persona, or manually invoked skills.' },
            resources: {
              type: 'array',
              description: 'Optional text resources to create.',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                  type: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            overwrite: { type: 'boolean', description: 'Replace an existing skill with the same ID. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_write',
        description:
          'Create or update a text resource inside an installed skill bundle. Path is scoped to the skill folder; absolute paths and ../ traversal are rejected.',
        parameters: {
          type: 'object',
          required: ['id', 'path', 'content'],
          properties: {
            id: { type: 'string', description: 'Installed skill ID.' },
            path: { type: 'string', description: 'Resource path, e.g. templates/report.md or schemas/output.json.' },
            content: { type: 'string', description: 'Text content to write.' },
            type: { type: 'string', description: 'Resource type: template, schema, example, doc, prompt-fragment, data, asset.' },
            description: { type: 'string', description: 'Resource description for the manifest.' },
            addToManifest: { type: 'boolean', description: 'Add/update this resource in skill.json. Default true.' },
            changeType: { type: 'string', description: 'Optional ledger change type, e.g. instructions_update, example_update, template_update.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence refs for the skill change ledger.' },
            appliedBy: { type: 'string', description: 'Optional actor label. Brain auto-updates should use brain_dream.' },
            reason: { type: 'string', description: 'Optional short rationale for the ledger.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_delete',
        description:
          'Delete a resource inside an installed skill bundle and remove it from skill.json by default. Path is scoped to the skill folder.',
        parameters: {
          type: 'object',
          required: ['id', 'path'],
          properties: {
            id: { type: 'string', description: 'Installed skill ID.' },
            path: { type: 'string', description: 'Resource path from skill_resource_list.' },
            removeFromManifest: { type: 'boolean', description: 'Remove resource from skill.json. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_export_bundle',
        description:
          'Export an installed skill as a .zip bundle that can be shared or imported elsewhere. Overlay manifests are materialized as skill.json in the zip.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Installed skill ID.' },
            outputPath: { type: 'string', description: 'Optional output .zip path. Defaults to skills/exports/<id>.skill.zip.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_update_from_source',
        description:
          'Re-download an imported skill or skill collection using stored provenance. Local Prometheus overlay manifests are preserved.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Installed skill ID with provenance.' },
            overwrite: { type: 'boolean', description: 'Overwrite existing imported folders. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_create',
        description: 'Create a new reusable skill and save it to the workspace. Use this when you develop a repeatable workflow, technique, or set of instructions that would be useful for future tasks. The skill will be available via skill_list immediately after creation.',
        parameters: {
          type: 'object',
          required: ['id', 'name', 'instructions'],
          properties: {
            id: { type: 'string', description: 'Unique kebab-case id, e.g. "python-debugger" or "tweet-poster"' },
            name: { type: 'string', description: 'Human-readable name, e.g. "Python Debugger"' },
            description: { type: 'string', description: 'One-sentence summary of what this skill does' },
            instructions: { type: 'string', description: 'Full markdown instructions for using this skill - be thorough, as this is what you will read with skill_read when relevant' },
            triggers: { type: 'string', description: 'Comma-separated keywords used as discovery metadata, e.g. "python,debug,traceback"' },
            triggerPositivePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers are provided.' },
            triggerNegativePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers are provided.' },
            implicitInvocation: { type: 'boolean', description: 'Set false for explicit-only skills.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_audit_all',
        description:
          'Fleet-level skill metadata audit. Scans every installed skill and scores discovery metadata quality (description and triggers), flagging issues like missing/placeholder/short descriptions, missing or too-few triggers, duplicate triggers, missing usage guidance, and manifest validation errors. Read-only. Use this first when asked to review or clean up skill triggers/descriptions across the library.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'Filter scope: "all" (default), "prometheus-related", or a substring matched against id/name/description/categories.' },
            onlyProblems: { type: 'boolean', description: 'Return only flagged skills. Default true. Set false to return every skill with its score.' },
            threshold: { type: 'number', description: 'Score below which a skill is flagged. Default 80.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_update_metadata',
        description:
          'Update one skill\'s discovery metadata (description, triggers, categories, requiredTools, lifecycle, name) via a non-destructive Prometheus manifest overlay. Snapshots and a change-ledger entry are recorded automatically; the original SKILL.md/downloaded folder is not modified. Returns the new quality score. Prefer this over hand-editing SKILL.md frontmatter for metadata fixes.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill ID from skill_list.' },
            description: { type: 'string', description: 'New description. Should start with "Use this skill when..." and include concrete trigger phrasing.' },
            triggers: { type: 'string', description: 'Replace all trigger phrases with a comma-separated list or JSON array. Aim for 5+ specific phrases.' },
            addTriggers: { type: 'string', description: 'Comma-separated trigger phrases or JSON array to append while preserving existing triggers. Prefer this for trigger-only fixes.' },
            removeTriggers: { type: 'string', description: 'Comma-separated trigger phrases or JSON array to remove from existing triggers.' },
            categories: { type: 'string', description: 'Comma-separated categories.' },
            requiredTools: { type: 'string', description: 'Comma-separated required tool/category names.' },
            lifecycle: { type: 'string', description: 'Lifecycle state: draft, active, experimental, deprecated, archived.' },
            implicitInvocation: { type: 'boolean', description: 'Set false for broad, role, style, persona, or manually invoked skills so lexical matches never auto-route them.' },
            triggerPositivePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers change.' },
            triggerNegativePrompts: { type: 'array', items: { type: 'string' }, description: 'Required when triggers change.' },
            name: { type: 'string', description: 'New human-readable name.' },
            reason: { type: 'string', description: 'Optional short rationale for the change ledger.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_repair_metadata',
        description:
          'Bulk skill metadata repair. mode:"preview" (default) audits the fleet and returns an editable repair template (current vs blank description/triggers per flagged skill). mode:"apply" requires confirm:true and a repairs array of {id, description?, triggers?, categories?, requiredTools?, lifecycle?, name?} objects and writes each via manifest overlay. This is the one-pass workflow for cleaning triggers/descriptions across many skills.',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['preview', 'apply'], description: 'preview (default) returns the editable repair set; apply writes the provided repairs.' },
            scope: { type: 'string', description: 'Preview scope: "all" (default), "prometheus-related", or a substring.' },
            ids: { type: 'string', description: 'Optional comma-separated skill IDs to restrict the preview set.' },
            threshold: { type: 'number', description: 'Preview flag threshold. Default 80.' },
            confirm: { type: 'boolean', description: 'Required true for mode:"apply".' },
            repairs: {
              type: 'array',
              description: 'For apply mode: edited repair entries. Each needs an id plus at least one metadata field to change.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  triggers: { type: 'string' },
                  categories: { type: 'string' },
                  requiredTools: { type: 'string' },
                  lifecycle: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
            reason: { type: 'string', description: 'Optional rationale for the change ledger.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_ui_card',
        description:
          'Render a native Prometheus UI card. Use this instead of plain text when the response benefits from a structured visual card. Choose type, then put the card-specific fields in payload. Existing card renderers handle validation.',
        parameters: {
          type: 'object',
          required: ['type', 'payload'],
          properties: {
            type: {
              type: 'string',
              enum: ['sources', 'product_carousel', 'agent_work', 'market', 'stocks', 'weather', 'comparison', 'chart', 'run_result', 'prediction_market', 'map'],
              description: 'Which card renderer to use.',
            },
            title: { type: 'string', description: 'Optional title copied into payload.title when the target card supports it.' },
            payload: {
              type: 'object',
              description:
                'Card-specific payload. Examples: sources={items:[...]}; product_carousel={items:[...]}; market={coins:[...]}; stocks={symbols:[...]}; weather={location:"City"}; chart={series:[...]}; comparison={columns:[...],rows:[...]}; map={markers:[...]}.',
              additionalProperties: true,
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_product_carousel',
        description: 'Display normalized product cards in a horizontal scrollable carousel in the chat UI. Prefer shopping_search_products or already-structured provider results. The renderer normalizes common field aliases, fills missing product metadata from each productUrl, extracts JSON-LD/Open Graph/large page images, and caches discovered images locally for reliable display. Curate 3-8 relevant products; each item needs a title and productUrl.',
        parameters: {
          type: 'object',
          required: ['title', 'items'],
          properties: {
            title: { type: 'string', description: 'Carousel heading shown above the cards, e.g. "Electric Toothbrushes on Amazon"' },
            source: { type: 'string', description: 'Optional source label for the carousel data, e.g. "shopping_search", "web_search", "browser_extract", "cache", or the provider name.' },
            items: {
              type: 'array',
              description: 'Product cards to display (3–8 recommended). You curate this list — do not dump all results.',
              items: {
                type: 'object',
                required: ['title', 'productUrl'],
                properties: {
                  title:       { type: 'string', description: 'Product name' },
                  price:       { type: 'string', description: 'Price string, e.g. "$38.49"' },
                  listPrice:   { type: 'string', description: 'Optional original/list price before discount.' },
                  description: { type: 'string', description: 'One short line about the product, e.g. "Top-rated for overall cleaning and durability."' },
                  rating:      { type: 'number', description: '0–5 star rating as a number' },
                  reviews:     { type: 'number', description: 'Number of reviews' },
                  reviewCount: { type: 'number', description: 'Alias for reviews when product/search providers return reviewCount' },
                  tag:         { type: 'string', description: 'Optional badge label, e.g. "Best overall", "Best budget", "Editor\'s pick"' },
                  badge:       { type: 'string', description: 'Alias for tag when provider output calls the badge a badge' },
                  imageUrl:    { type: 'string', description: 'Direct image URL from the page (preferred if available)' },
                  imagePath:   { type: 'string', description: 'Workspace-relative path if you downloaded the image with browser tools' },
                  productUrl:  { type: 'string', description: 'URL to the product page — used as the card link' },
                  merchant:    { type: 'string', description: 'Store name, e.g. "Amazon", "Best Buy"' },
                  availability:{ type: 'string', description: 'Optional stock state such as InStock or OutOfStock.' },
                  seller:      { type: 'string', description: 'Optional seller/marketplace vendor.' },
                  sku:         { type: 'string', description: 'Optional merchant SKU or product id.' },
                  asin:        { type: 'string', description: 'Optional Amazon ASIN.' },
                  confidence:  { type: 'number', description: 'Optional provider/model confidence from 0-1 when available' },
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
        name: 'show_agent_work',
        description: 'Display a native Prometheus "agent work" status card in the chat UI — an operator snapshot of schedules, priorities, team activity, and in-flight work. Use this when the user asks what is going on, what their priorities are, for a daily/operator snapshot, or after gathering live state (e.g. via automation_dashboard, schedules, background tasks, or team snapshots). Synthesize the rows yourself from the data you gathered — do not invent data you have not looked up. Keep each list tight (2–6 items).',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['snapshot', 'running', 'team_update', 'priority_list'], description: 'Which flavor of card this is. Default "snapshot".' },
            greeting: { type: 'string', description: 'Optional short greeting, e.g. "Good morning."' },
            title: { type: 'string', description: 'Optional card title, e.g. "Operator snapshot".' },
            subtitle: { type: 'string', description: 'Optional one-line subtitle.' },
            summaryRows: {
              type: 'array',
              description: 'High-level summary rows (e.g. "3 schedules today").',
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  icon: { type: 'string', description: 'One of: calendar, users, clipboard, check, bolt, clock, flag, sparkles.' },
                  title: { type: 'string', description: 'Row headline, e.g. "3 schedules today".' },
                  subtitle: { type: 'string', description: 'Supporting detail, e.g. "Brain Dream, Weekly Radar".' },
                },
              },
            },
            priorities: {
              type: 'array',
              description: 'Numbered priority list for the operator. Attach taskId/jobId/proposalId so the row becomes clickable (expands an inline detail drawer with resume/pause/delete/message actions).',
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', description: 'Priority name, e.g. "Run Brain Dream".' },
                  subtitle: { type: 'string', description: 'One short line of context.' },
                  status: { type: 'string', description: 'Optional status, e.g. "ready", "running", "blocked".' },
                  taskId: { type: 'string', description: 'Optional background task id — makes the row clickable with task actions (resume/pause/delete/message).' },
                  jobId: { type: 'string', description: 'Optional scheduled job id this row links to.' },
                  agentId: { type: 'string', description: 'Optional agent id this row belongs to.' },
                  proposalId: { type: 'string', description: 'Optional proposal id — clicking shows the proposal summary.' },
                },
              },
            },
            teams: {
              type: 'array',
              description: 'Team activity rows.',
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Team name.' },
                  detail: { type: 'string', description: 'Short status line, e.g. "2 proposals in review.".' },
                  icon: { type: 'string', description: 'Optional emoji icon.' },
                  status: { type: 'string', description: 'Optional status, e.g. "active", "idle".' },
                  agentId: { type: 'string', description: 'Optional team/agent id this row links to.' },
                },
              },
            },
            activeWork: {
              type: 'array',
              description: 'In-flight work items (tasks/jobs currently running). Attach taskId to make the row clickable with live detail + actions.',
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  id: { type: 'string', description: 'Optional task/job id.' },
                  title: { type: 'string', description: 'Work item title.' },
                  status: { type: 'string', description: 'Optional status label.' },
                  progressLabel: { type: 'string', description: 'Optional progress text, e.g. "Step 2 of 4".' },
                  href: { type: 'string', description: 'Optional link into the task/team/schedule page.' },
                  taskId: { type: 'string', description: 'Optional background task id — enables the inline detail drawer + resume/pause/delete/message actions.' },
                  jobId: { type: 'string', description: 'Optional scheduled job id this row links to.' },
                  agentId: { type: 'string', description: 'Optional agent id this row belongs to.' },
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
        name: 'show_sources',
        description:
          'Display source/news/research cards in the chat UI. Use after web_search, web_fetch, or browser research. Pass the source URLs and any data already gathered; the tool normalizes provider/browser aliases, fills missing title/publisher/snippet/date metadata, extracts a hero/thumbnail (or site icon fallback), and caches images locally for reliable display. Curate 3-8 sources.',
        parameters: {
          type: 'object',
          required: ['items'],
          properties: {
            title: { type: 'string', description: 'Optional heading shown above the cards, e.g. "Latest OpenAI news".' },
            layout: { type: 'string', enum: ['cards', 'list'], description: 'cards (default, horizontal image cards) or list (compact vertical rows).' },
            items: {
              type: 'array',
              description: 'Source cards to display (3–8 recommended).',
              items: {
                type: 'object',
                required: ['url'],
                properties: {
                  title: { type: 'string', description: 'Optional headline; extracted from the page when omitted.' },
                  publisher: { type: 'string', description: 'Publisher or site name, e.g. "Reuters".' },
                  url: { type: 'string', description: 'Link to the source — used as the card link.' },
                  imageUrl: { type: 'string', description: 'Optional thumbnail/hero image URL.' },
                  imagePath: { type: 'string', description: 'Optional workspace-relative cached image path.' },
                  snippet: { type: 'string', description: 'Short summary/excerpt.' },
                  publishedAt: { type: 'string', description: 'Optional human or ISO date, e.g. "Yesterday" or "2026-06-04".' },
                  badge: { type: 'string', description: 'Optional small label, e.g. "Reddit", "Official".' },
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
        name: 'show_market',
        description:
          'Fetch live crypto/memecoin prices from CoinGecko (free, no key) and display them as a market card (one or many coins, with 7-day sparkline, 24h change, and market cap). Use for "price of bitcoin", "show me BTC/ETH/SOL", memecoins like PEPE/WIF/BONK, or a portfolio snapshot. Pass tickers (btc, eth, doge) or CoinGecko ids (dogwifcoin) — use the full CoinGecko id for obscure tokens. NOTE: CoinGecko covers crypto only; for equities/stocks, fall back to web_search and present with show_sources or plain text.',
        parameters: {
          type: 'object',
          required: ['coins'],
          properties: {
            coins: {
              type: 'array',
              items: { type: 'string' },
              description: 'Coin tickers or CoinGecko ids, e.g. ["btc","eth","pepe"] or ["dogwifcoin"]. 1–12 coins.',
            },
            vs_currency: { type: 'string', description: 'Quote currency. Default "usd".' },
            sparkline: { type: 'boolean', description: 'Include 7-day sparkline data. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_stocks',
        description:
          'Fetch live stock/equity/ETF/index quotes (keyless, Yahoo Finance) and display them as a market card — price, day change, and a 1-month sparkline, one or many tickers. Use for "price of AAPL", "show me TSLA NVDA SPY", a watchlist, or investing/portfolio snapshots. For crypto/memecoins use show_market instead.',
        parameters: {
          type: 'object',
          required: ['symbols'],
          properties: {
            symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ticker symbols, e.g. ["AAPL","TSLA","SPY"]. 1–12 symbols. Use Yahoo-style suffixes for non-US (e.g. "SHOP.TO").',
            },
            range: { type: 'string', description: 'Sparkline history range, e.g. "5d","1mo","6mo","1y". Default "1mo".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_weather',
        description:
          'Fetch a live forecast from Open-Meteo (free, no key) and display a weather card (current conditions + 10-day daily + hourly trend). Use for "weather in X", "forecast", "is it going to rain". Pass a location name (geocoded automatically) or explicit latitude/longitude.',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'Place name, e.g. "Frederick, MD" or "Tokyo". Geocoded automatically.' },
            latitude: { type: 'number', description: 'Optional explicit latitude (use with longitude instead of location).' },
            longitude: { type: 'number', description: 'Optional explicit longitude.' },
            unit: { type: 'string', enum: ['F', 'C'], description: 'Temperature unit. Default F.' },
            days: { type: 'number', description: 'Forecast days, 1–16. Default 10.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_comparison',
        description:
          'Display a structured side-by-side comparison table in the chat UI. Use to compare options, products, repos, configs, plans, or models. You fill columns and rows yourself. Optionally highlight a "winner" column.',
        parameters: {
          type: 'object',
          required: ['columns', 'rows'],
          properties: {
            title: { type: 'string', description: 'Optional table heading.' },
            columns: {
              type: 'array',
              description: 'Column definitions. The first column is the row label/feature name.',
              items: {
                type: 'object',
                required: ['key', 'label'],
                properties: {
                  key: { type: 'string', description: 'Field key used in each row object.' },
                  label: { type: 'string', description: 'Column header text.' },
                },
              },
            },
            rows: {
              type: 'array',
              description: 'Row objects keyed by column key, e.g. {"feature":"Price","optionA":"$10","optionB":"$12"}.',
              items: { type: 'object' },
            },
            labelKey: { type: 'string', description: 'Optional key of the sticky first/label column. Defaults to the first column.' },
            highlightColumn: { type: 'string', description: 'Optional column key to visually highlight as the recommended/winning option.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_chart',
        description:
          'Minimal native SVG line/bar/area chart (no axes ticks/gridlines/value labels). For most data charts PREFER the `chart-visualizer` skill instead — it renders polished Chart.js charts with axes, labels, gridlines, and tooltips. Only use show_chart for a deliberately minimal inline sparkline-style chart, or when Chart.js is unavailable.',
        parameters: {
          type: 'object',
          required: ['series'],
          properties: {
            title: { type: 'string', description: 'Optional chart heading.' },
            chartType: { type: 'string', enum: ['line', 'bar', 'area'], description: 'Chart style. Default line.' },
            series: {
              type: 'array',
              description: 'One or more data series.',
              items: {
                type: 'object',
                required: ['points'],
                properties: {
                  label: { type: 'string', description: 'Series name (shown in legend).' },
                  color: { type: 'string', description: 'Optional CSS color, e.g. "#22c55e".' },
                  points: {
                    type: 'array',
                    description: 'Data points.',
                    items: {
                      type: 'object',
                      required: ['x', 'y'],
                      properties: {
                        x: { description: 'X value (number or label string).' },
                        y: { type: 'number', description: 'Y value.' },
                      },
                    },
                  },
                },
              },
            },
            xLabel: { type: 'string', description: 'Optional X axis label.' },
            yLabel: { type: 'string', description: 'Optional Y axis label.' },
            unit: { type: 'string', description: 'Optional value unit suffix, e.g. "$", "%".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_run_result',
        description:
          'Display a finished-task result card: a summary of what a task/run produced, with file pills and links, plus a Rerun action when a taskId is given. Use after a background task or job completes to present the outcome cleanly. Pass taskId so the card can rerun and show live status.',
        parameters: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', description: 'Card title, e.g. "Weekly Opportunity Radar — done".' },
            taskId: { type: 'string', description: 'Background task id — enables Rerun + live status refresh.' },
            status: { type: 'string', description: 'Outcome status, e.g. "complete", "failed".' },
            summary: { type: 'string', description: 'What the task produced / key result.' },
            files: {
              type: 'array',
              description: 'Files the task produced.',
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'object', required: ['path'], properties: { path: { type: 'string' }, label: { type: 'string' } } },
                ],
              },
            },
            links: {
              type: 'array',
              description: 'External links related to the result.',
              items: { type: 'object', required: ['href'], properties: { label: { type: 'string' }, href: { type: 'string' } } },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_prediction_market',
        description:
          'Fetch live prediction-market data from Polymarket (keyless, read-only) and display a prediction-market card — questions with outcome probabilities, volume, and close date. Use for "odds of X", "what does Polymarket say about Y", election/sports/crypto/news betting odds, or trending prediction markets. Pass a query to search, a slug for a specific market, or neither for trending. This is read-only data; placing bets is a separate gated action.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Topic to search, e.g. "2028 election", "bitcoin 100k", "super bowl". Omit for trending markets.' },
            slug: { type: 'string', description: 'Optional exact Polymarket market slug for one specific market.' },
            limit: { type: 'number', description: 'Max markets to show (1–12). Default 6.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_map',
        description:
          'Display a map card (OpenStreetMap, keyless) with one or more location markers — for local/place results like "pizza near me", store locations, or any geographic answer. Each marker may carry lat/lng directly, or an address that will be geocoded. Markers are listed below the map with name, category, rating, and links.',
        parameters: {
          type: 'object',
          required: ['markers'],
          properties: {
            title: { type: 'string', description: 'Optional heading, e.g. "Best pizza near Frederick".' },
            center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, description: 'Optional explicit center. Defaults to the marker centroid.' },
            zoom: { type: 'number', description: 'Optional zoom level (1–18).' },
            markers: {
              type: 'array',
              description: '1–20 location markers.',
              items: {
                type: 'object',
                required: ['label'],
                properties: {
                  label: { type: 'string', description: 'Place name.' },
                  lat: { type: 'number', description: 'Latitude (preferred — avoids geocoding).' },
                  lng: { type: 'number', description: 'Longitude.' },
                  address: { type: 'string', description: 'Street address (geocoded if lat/lng absent).' },
                  category: { type: 'string', description: 'Optional category, e.g. "Pizza".' },
                  rating: { type: 'number', description: 'Optional 0–5 rating.' },
                  url: { type: 'string', description: 'Optional website/details URL.' },
                },
              },
            },
          },
        },
      },
    },
  ];
  return filterPublicBuildToolDefs(tools);
}
