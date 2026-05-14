// src/gateway/tools/defs/cis-system.ts
// Tool definitions for CIS (Competitive Intelligence System), self-improvement, and system management.

import { filterPublicBuildToolDefs, getPublicBuildAllowedCategories } from '../../../runtime/distribution.js';

export function getCisSystemTools(): any[] {
  const categoryDocs: Array<[string, string]> = [
    ['browser_automation', 'browser_automation - web UI automation tools (browser_open, browser_click, browser_fill, save_site_shortcut, etc.)'],
    ['desktop_automation', 'desktop_automation - OS/desktop automation tools (desktop_screenshot, desktop_click, desktop_launch_app, etc.)'],
    ['agents_and_teams', 'agents_and_teams - standalone subagents, managed teams, team chat, dispatches, and agent updates.'],
    ['prometheus_source_read', 'prometheus_source_read - Prometheus app/source inspection tools (read_source, grep_source, read_prom_file, etc.)'],
    ['prometheus_source_write', 'prometheus_source_write - Prometheus app/source editing tools for approved dev proposal tasks only.'],
    ['workspace_write', 'workspace_write - workspace file mutation tools (create_file, replace_lines, delete_file, rename_file, etc.)'],
    ['advanced_memory', 'advanced_memory - memory graph, timeline, project-scoped search, related-record, and index refresh tools.'],
    ['media_assets', 'media_assets - download and media analysis tools (download_url, download_media, analyze_image, analyze_video).'],
    ['media_quality', 'media_quality - image/video validation and render inspection tools (contrast, text overflow, frame renders, caption/audio timing).'],
    ['automations', 'automations - scheduling and automation management tools (schedule_job, history, outputs, patching, stuck control).'],
    ['external_apps', 'external_apps - connected external app tools (Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4, Obsidian). Use connector_list first.'],
    ['integration_admin', 'integration_admin - MCP server, webhook, and integration setup/admin tools.'],
    ['social_intelligence', 'social_intelligence - social profile intelligence and reporting tools.'],
    ['proposal_admin', 'proposal_admin - proposal inspection/editing administration tools.'],
    ['mcp_server_tools', 'mcp_server_tools - dynamic tools exposed by connected MCP servers (shown as mcp__server__tool). Use only for trusted servers.'],
    ['composite_tools', 'composite_tools - saved multi-step composite tools plus create/get/edit/delete/list composite management tools.'],
    ['creative_mode', 'creative_mode - normal main-chat creative editor tools and workspace selectors.'],
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
    'media_quality',
    'automations',
    'external_apps',
    'integration_admin',
    'social_intelligence',
    'proposal_admin',
    'mcp_server_tools',
    'composite_tools',
    'creative_mode',
  ] as const);
  const requestToolCategoryDescription =
    'Activate a tool category for this session, unlocking those tool schemas for use. ' +
    'Once activated, the category stays active for the entire session. ' +
    'Available categories:\n' +
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
          'IMPORTANT: Do NOT call team_manage directly from main chat. Use this tool for managed team work. Standalone one-off subagents are separate: main chat may use spawn_subagent and message_subagent directly for a single non-team agent.',
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
        name: 'webhook_manage',
        description: 'Manage webhook settings. Actions: get, set, test.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'Action: get | set | test' },
            enabled: { type: 'boolean', description: 'Enable/disable webhook endpoint (set action)' },
            token: { type: 'string', description: 'Webhook auth token (set action)' },
            path: { type: 'string', description: 'Webhook base path, e.g. /hooks (set action)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'mcp_server_manage',
        description: 'Manage MCP server config and connection lifecycle. Actions: list, status, upsert, import, connect, disconnect, delete, list_tools, start_enabled.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'Action to run: list | status | upsert | import | connect | disconnect | delete | list_tools | start_enabled' },
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
                  enum: ['code_change', 'action', 'review'],
                  description: 'Execution lane used after approval.',
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
          'Read the current model routing configuration: global primary model, agent_model_defaults, and per-agent model overrides. ' +
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
        name: 'set_agent_model',
        description:
          'Safely update live model routing in .prometheus/config.json without raw file writes. ' +
          'Use agent_type to update an allowlisted agent_model_defaults key, or agent_id to update a specific configured agent override. ' +
          'Critical outage use: when proposals/background work are blocked by a provider quota event, set proposal_executor_low_risk, background_agent, coordinator, or subagent_* defaults to a working provider/model such as openai_codex/gpt-5.5. ' +
          'Changes are persisted through the Settings API and take effect for new proposal executions, background agents, subagents, and model switches.',
        parameters: {
          type: 'object',
          required: ['model'],
          properties: {
            model: {
              type: 'string',
              description: 'Provider/model route in "provider/model" format, e.g. "openai_codex/gpt-5.5".',
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
                'background_agent',
              ],
              description: 'Allowlisted default route to update in agent_model_defaults.',
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
          'Create or update a named template snapshot for agent_model_defaults. ' +
          'If defaults is omitted, the current live defaults are saved. Use id or an existing name to modify a saved template.',
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
        name: 'write_proposal',
	        description:
	          'Submit a proposal for human approval. Use for any change that requires human review before execution. Every executable proposal should choose exactly one execution_mode: code_change, action, or review. The proposal will appear in the Prometheus proposals panel for approval or denial. ' +
            'When used by a team manager, executor_agent_id is REQUIRED and must name a subagent on that same team; approved execution will use that subagent model/context and report back to team chat. ' +
            'For executable proposals, include execution_steps as the approved checklist the executor should follow after approval; dispatch requires at least two steps. ' +
	          'Use execution_mode=code_change only for Prometheus dev self-edits touching src/ or web-ui/. REQUIRED for src/ edits: details MUST contain these exact section headings: "Why this change", "Exact source edits", "Deterministic behavior after patch", "Acceptance tests", "Risks and compatibility".',
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
              enum: ['code_change', 'action', 'review'],
              description: 'Execution lane. code_change = Prometheus dev self-edit under src/ or web-ui/ only. action = approve and do/trigger/create something once. review = read-mostly verification/audit/report.',
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
    // ── gateway_restart: build + graceful restart for proposals/repairs ────────
    {
      type: 'function',
      function: {
        name: 'gateway_restart',
        description:
          'Build TypeScript and gracefully restart the gateway. Use ONLY after applying source code changes ' +
          '(proposals, repairs, src edits) that require a restart to take effect. ' +
          'Runs npm run build in-process, then if successful, shuts down all subsystems and respawns the gateway. ' +
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
            test_instructions: { type: 'string', description: 'What to verify after restart' },
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
              description: 'Category to activate for this session',
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
        name: 'skill_list',
        description: 'List all available skills with their ID, emoji, and description. Call this before browser/desktop automation, file edits, or other execution-heavy work to check for a relevant playbook, then use skill_read(id) for full instructions.',
        parameters: { type: 'object', required: [], properties: {} },
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
            categories: { type: 'string', description: 'Comma-separated categories.' },
            requiredTools: { type: 'string', description: 'Comma-separated required tool/category names.' },
            permissions: { type: 'object', description: 'Permission hints such as browser, workspaceRead, workspaceWrite, shell, externalSideEffects.' },
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
          },
        },
      },
    },
  ];
  return filterPublicBuildToolDefs(tools);
}
