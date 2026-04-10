// src/gateway/tools/defs/cis-system.ts
// Tool definitions for CIS (Competitive Intelligence System), self-improvement, and system management.

import { filterPublicBuildToolDefs, getPublicBuildAllowedCategories } from '../../../runtime/distribution.js';

export function getCisSystemTools(): any[] {
  const categoryDocs: Array<[string, string]> = [
    ['browser', 'browser — 20 web automation tools (browser_open, browser_click, browser_fill, etc.)'],
    ['desktop', 'desktop — 26 OS/desktop automation tools (desktop_screenshot, desktop_click, etc.)'],
    ['team_ops', 'team_ops — 19 agent/team coordination tools (spawn_subagent, team_manage, dispatch_team_agent, etc.)'],
    ['source_write', 'source_write — 10 code editing tools (find_replace_source, write_source, etc.)'],
    ['integrations', 'integrations — 5 MCP/webhook/CIS tools (mcp_server_manage, webhook_manage, social_intel, etc.)'],
  ];
  const categoryEnum = getPublicBuildAllowedCategories([
    'browser',
    'desktop',
    'team_ops',
    'source_write',
    'integrations',
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
          'IMPORTANT: Do NOT call team_manage or spawn_subagent directly from main chat — always use this tool.',
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
          'Deploy a one-shot website intelligence analysis for any URL. ' +
          'Spawns 5 specialists in parallel via background_spawn (SEO, Performance/Stack, AI Visibility/GEO, Backlinks/SERP, Content), ' +
          'then compiles everything into a beautiful HTML dashboard report saved to the workspace. ' +
          'Returns the report content AND a reportPath (absolute path to the .html file). ' +
          'AFTER the tool returns: (1) call present_file({ path: <reportPath> }) to open the dashboard in the canvas, ' +
          '(2) write a concise executive summary with the top 3 actionable recommendations. ' +
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
    // ── get_agent_result: collect result from a background-dispatched agent ───
    {
      type: 'function',
      function: {
        name: 'get_agent_result',
        description: 'Collect the result of an agent dispatched with background=true. By default waits until the agent finishes (block=true). Pass block=false to check status without waiting — useful for polling. The task_id comes from the dispatch_team_agent response.',
        parameters: {
          type: 'object',
          required: ['task_id'],
          properties: {
            task_id: { type: 'string', description: 'The task_id returned by dispatch_team_agent with background=true' },
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
        description: 'Reply to a team coordinator\'s message. Use this when a team has sent you (the main agent) a planning question, error report, or other message that needs a response. Your reply will appear in the team chat and auto-resume the coordinator if they are waiting.',
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
            action: { type: 'string', enum: ['set_focus', 'set_mission', 'log_completed', 'add_milestone', 'update_milestone', 'pause_agent', 'unpause_agent'], description: 'The goal management action to perform' },
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
        name: 'write_proposal',
        description:
          'Submit a proposal for human approval. Use for any change that requires human review before execution: src/ code edits, new features, major config changes. The proposal will appear in the Prometheus proposals panel for you to approve or deny. ' +
          'REQUIRED for src/ edits: details MUST contain these exact section headings: "Why this change", "Exact source edits", "Deterministic behavior after patch", "Acceptance tests", "Risks and compatibility". Proposals without them will be rejected.',
        parameters: {
          type: 'object',
          required: ['type', 'title', 'summary', 'details'],
          properties: {
            type: {
              type: 'string',
              enum: ['feature_addition', 'src_edit', 'config_change', 'task_trigger', 'memory_update', 'skill_evolution', 'prompt_mutation', 'general'],
              description: 'Category of change',
            },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'How urgent (default: medium)' },
            title: { type: 'string', description: 'Short title shown in the proposals panel (max 120 chars)' },
            summary: { type: 'string', description: '1-3 sentence summary of what will change and why (shown in notification)' },
            details: {
              type: 'string',
              description:
                'Full implementation details, markdown. When affected_files includes any src/ path, you MUST include these exact headings and content: "Why this change", "Exact source edits", "Deterministic behavior after patch", "Acceptance tests", "Risks and compatibility". Otherwise the proposal will be rejected.',
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
            diff_preview: { type: 'string', description: 'Optional: code diff or before/after snippet' },
            estimated_impact: { type: 'string', description: 'e.g. "adds browser caching, reduces API calls by ~40%"' },
            requires_build: { type: 'boolean', description: 'True if src/ TypeScript changes need npm run build' },
            executor_agent_id: { type: 'string', description: 'Which agent should execute this when approved (e.g. code_executor)' },
            executor_prompt: { type: 'string', description: 'Exact prompt to send the executor agent when approved' },
            risk_tier: {
              type: 'string',
              enum: ['low', 'high'],
              description: "Execution model assignment. 'low' = small isolated change (UI tweak, config field, 1-2 files) → runs on Haiku. 'high' = core logic, auth, multi-file, build changes → runs on Codex. Omit to default to Codex (safe).",
            },
          },
        },
      },
    },
    // ── self_improve tool ────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'self_improve',
        description: 'Access the self-improvement engine. Read performance reports, schedule health, error patterns, behavior changelog, and pending proposals. Also add changelog entries and query the prompt library.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: [
                'get_summary',           // overall status snapshot
                'get_latest_report',     // last weekly perf report
                'get_schedule_health',   // per-job success rates & errors
                'get_error_summary',     // error watchdog state
                'get_goals',             // active goal decompositions
                'get_changelog',         // recent behavior changes
                'get_pending_proposals', // proposals awaiting human approval
                'get_pending_skills',    // skill evolutions awaiting approval
                'add_changelog_entry',   // record a behavior change
                'get_proven_patterns',   // prompt library for a category
              ],
              description: 'Which operation to perform',
            },
            change: { type: 'string', description: 'For add_changelog_entry: what was changed' },
            reason: { type: 'string', description: 'For add_changelog_entry: why it was changed' },
            job_name: { type: 'string', description: 'For add_changelog_entry: affected job name' },
            expected_impact: { type: 'string', description: 'For add_changelog_entry: expected improvement' },
            category: { type: 'string', description: 'For get_proven_patterns: task category (e.g. web_research, social_media_posting)' },
            limit: { type: 'number', description: 'For get_changelog: how many recent entries (default 10)' },
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
        name: 'skill_create',
        description: 'Create a new reusable skill and save it to the workspace. Use this when you develop a repeatable workflow, technique, or set of instructions that would be useful for future tasks. The skill will be available via skill_list immediately after creation.',
        parameters: {
          type: 'object',
          required: ['id', 'name', 'instructions'],
          properties: {
            id: { type: 'string', description: 'Unique kebab-case id, e.g. "python-debugger" or "tweet-poster"' },
            name: { type: 'string', description: 'Human-readable name, e.g. "Python Debugger"' },
            description: { type: 'string', description: 'One-sentence summary of what this skill does' },
            instructions: { type: 'string', description: 'Full markdown instructions for using this skill — be thorough, as this is what you will read when the skill is enabled in future sessions' },
            emoji: { type: 'string', description: 'Single emoji representing this skill' },
            triggers: { type: 'string', description: 'Comma-separated keywords that will auto-activate this skill when matched against tool names or messages, e.g. "python,debug,traceback"' },
          },
        },
      },
    },
  ];
  return filterPublicBuildToolDefs(tools);
}
