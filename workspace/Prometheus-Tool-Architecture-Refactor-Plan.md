Can you please investigate current state prometheus and then this plan, id also like to bring forward the analyze videoctool and background_spawn tool to the core tools as well please - Prometheus Tool Architecture Refactor Plan

Goal

Reduce core tool context size while preserving functionality by moving administrative, advanced, and rarely-used tools into capability categories.

⸻

Core Tools

These tools remain loaded in every session.

Files & Retrieval

* list_files
* read_file
* file_stats
* grep_file
* search_files

Web

* web_search
* web_fetch

Memory

* memory_read
* memory_write
* memory_search

Skills (Read-Only)

* skill_list
* skill_read
* skill_resource_list
* skill_resource_read

Scheduling & Automation

* schedule_job
* automation_dashboard
* timer

Model Management

* switch_model
* set_current_model

Business

* business_context_mode

Agent & Communication

* ask_team_coordinator
* deploy_analysis_team
* delivery_send
* delivery_send_screenshot

Core Utility

* update_heartbeat

⸻

Category: Skills

Load only when skill creation or management is required.

Move Here

* skill_create
* skill_create_bundle
* skill_import_bundle
* skill_export_bundle
* skill_update_from_source
* skill_manifest_write
* skill_resource_write
* skill_resource_delete
* skill_inspect

Purpose:

* Skill authoring
* Skill packaging
* Skill maintenance
* Bundle import/export

⸻

Category: Advanced Memory

Remove all advanced memory operations from core.

Move Here

* memory_browse
* memory_graph
* memory_timeline
* memory_related
* project memory tools
* relationship traversal tools

Purpose:

* Long-term memory analysis
* Graph exploration
* Project memory management

Core only needs:

* Read
* Write
* Search

⸻

Category: Automations

Core keeps only execution-level scheduling.

Core

* schedule_job
* automation_dashboard
* timer

Move Here

* task_control
* run_task_now
* internal_watch
* automation history tools
* automation patch tools
* automation output tools
* automation debugging tools
* automation recovery tools

Purpose:

* Advanced automation management
* Diagnostics
* Workflow repair

⸻

Category: Model Management

Core only needs model switching.

Core

* switch_model
* set_current_model

Move Here

* get_agent_models
* set_agent_model
* list_agent_model_templates
* save_agent_model_template
* update_agent_model_template
* apply_agent_model_template
* select_agent_model_template
* delete_agent_model_template

Purpose:

* Agent fleet management
* Template administration
* Multi-agent configuration

⸻

Category: Business

Core only needs business mode selection.

Core

* business_context_mode

Move Here

* list_entities
* read_entity
* write_entity
* append_entity_event

Future additions:

* CRM integrations
* Customer records
* Company knowledge graphs
* Lead management

Purpose:

* Business data administration
* Entity lifecycle management

⸻

Categories Remaining Unchanged

Browser Automation

* browser_open
* browser_click
* browser_fill
* browser_run_js
* etc.

Desktop Automation

* desktop_click
* desktop_type
* desktop_launch_app
* etc.

Agents & Teams

* background_spawn
* background_wait
* background_join
* spawn_subagent
* message_subagent
* etc.

Workspace Write

* create_file
* write_file
* run_command
* start_process
* etc.

Media Assets

* image/video analysis
* downloads

Media Quality

* QA tools

Integrations

* Gmail
* GitHub
* Salesforce
* HubSpot
* Slack
* Notion
* etc.

Creative Mode

* Creative editor tools

MCP Server Tools

* Dynamic MCP tool loading

⸻

Expected Result

Current:
~70+ tools loaded by default

Target:
~25-35 tools loaded by default

Benefits:

* Smaller prompts
* Faster tool selection
* Better tool accuracy
* Lower token usage
* Easier future expansion
* Cleaner capability activation model

Core becomes focused on:
Search + Files + Memory + Scheduling + Model Switching + Business Context + Communication

Everything else becomes capability-driven.