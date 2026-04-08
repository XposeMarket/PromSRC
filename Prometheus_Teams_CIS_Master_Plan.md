**PROMETHEUS**

Team System & CIS Integration

Master Implementation Plan

Current State Audit + Completion Roadmap

March 2026

*Post-Refactor Edition (server-v2 decomposed into routers)*

+-----------------------------------------------------------------------+
| **THE VISION**                                                        |
|                                                                       |
| Prometheus teams can automate anything: start a business from scratch |
| (website, Stripe, deploy), run daily operations (revenue checks,      |
| inventory), manage social media posting, run a news channel, or any   |
| persistent autonomous workflow. The user plans it in the main chat,   |
| creates a team, and the agents execute.                               |
|                                                                       |
| The CIS (Context Injection System) gives every team persistent        |
| business knowledge, live integrations, website intelligence, social   |
| media coaching, and a policy engine for safe autonomous operation.    |
+-----------------------------------------------------------------------+

**1. Current State Audit**

This section maps every CIS Plan item to its actual implementation
status in the codebase as of March 2026, after the full server-v2 router
refactor.

**1.1 Phase 1: Business Brain Foundation**

  ------------------------------ ------------- ---------------------------------
  **Component**                  **Status**    **Detail**

  **workspace/BUSINESS.md**      **FILE        Template created with all
                                 EXISTS**      sections (Company, Team, Clients,
                                               Products, Projects, Vendors,
                                               Policies, Dates). Currently
                                               empty/unfilled.

  **workspace/entities/          **FILE        clients/, contacts/, projects/,
  folders**                      EXISTS**      social/, vendors/ directories
                                               created with README.md.

  **types-cis.ts**               **DONE**      EntityFile,
                                               IntegrationConnection,
                                               IntegrationPermissions,
                                               PolicyRule, AuditLogEntry all
                                               defined.

  **BUSINESS.md auto-load in     **DONE**      buildPersonalityContext() in
  prompt**                                     prompt-context.ts loads
                                               BUSINESS.md (1200 char limit) on
                                               Tier 1, Tier 2/3, and autonomous
                                               paths.

  **conversation-learning.ts**   **PARTIAL**   File exists with heuristic
                                               scanner (no LLM).
                                               extractAndWrite() implemented but
                                               needs verification that it is
                                               actually called on session close.

  **Entity file read/write       **MISSING**   No write_entity or read_entity
  tools**                                      tools registered. Agents cannot
                                               create/update entity files via
                                               tools.

  **SOUL.md CIS awareness**      **MISSING**   SOUL.md has not been updated with
                                               CIS instructions (how to use
                                               BUSINESS.md, entities/).
  ------------------------------ ------------- ---------------------------------

**Phase 1 Verdict**

The foundation is structurally in place. The critical gap is that agents
have no tools to read/write entity files, SOUL.md does not teach the AI
about BUSINESS.md or entities, and conversation-learning may not be
wired into the session lifecycle. These are small, targeted fixes.

**1.2 Phase 2: Website Intelligence Team**

  ----------------------------- ------------ ---------------------------------
  **Component**                 **Status**   **Detail**

  **deploy-analysis-team.ts**   **FILE       Full tool file with 5 agent
                                EXISTS**     system prompts (SEO, Performance,
                                             GEO, Backlinks, Content Audit),
                                             report compiler, notify bridge
                                             call, cleanup logic.

  **notify-bridge.ts**          **DONE**     notifyMainAgent(),
                                             drainPendingEvents(),
                                             peekPendingEvents(),
                                             formatEventMessage() all
                                             implemented with file-based event
                                             queue.

  **events/pending.json**       **FILE       Event store file created and
                                EXISTS**     ready.

  **Tool registration**         **NEEDS      deploy_analysis_team needs to be
                                WORK**       verified as registered in
                                             tool-builder.ts or registry.

  **Dependency injection**      **NEEDS      injectAnalysisTeamDeps() must be
                                WORK**       called at boot with spawnAgent,
                                             workspacePath, broadcast.

  **One-shot team cleanup**     **NEEDS      type: \'one_shot\' flag and
                                WORK**       auto-delete after delivery needs
                                             verification in managed-teams.ts.

  **Event polling in chat**     **NEEDS      drainPendingEvents() must be
                                WORK**       called in the chat response cycle
                                             to inject team events.
  ----------------------------- ------------ ---------------------------------

**Phase 2 Verdict**

The heavy lifting is done. The files and logic exist. What is missing is
the wiring: registering the tool, injecting dependencies at boot, and
polling events in the chat loop. This is a 1-day wiring task.

**1.3 Phase 3: Social Media Intelligence**

  -------------------------- ------------- -----------------------------------------------
  **Component**              **Status**    **Detail**

  **social-scraper.ts**      **FILE        Full implementation with 3-tier fallback (API,
                             EXISTS**      Scrapling, browser), platform configs for
                                           Instagram/TikTok/X/LinkedIn/YouTube/Facebook.

  **Scrapling Python         **NEEDS       Shell subprocess call is coded but Scrapling
  bridge**                   WORK**        must be pip-installed and the Python script
                                           must exist on disk.

  **Official API             **PARTIAL**   Platform configs defined but actual OAuth flows
  connectors**                             for social platforms are not in
                                           connector-registry.ts (only Gmail, Slack,
                                           GitHub, Notion, Reddit, Google Drive are
                                           registered).

  **social_intel tool        **NEEDS       Tool must be registered in tool-builder.ts with
  registration**             WORK**        proper definition.

  **entities/social/         **FILE        Directory exists. social-scraper.ts writes to
  persistence**              EXISTS**      entities/social/\[platform\].md.

  **Social media skill       **MISSING**   No skill file for social intelligence analysis
  playbook**                               prompts.
  -------------------------- ------------- -----------------------------------------------

**Phase 3 Verdict**

The core scraper is built. The missing pieces are: pip-install
Scrapling, register the tool, add social platform OAuth connectors to
the registry, and create a social intelligence skill playbook. Medium
effort, 2-3 days.

**1.4 Phase 4: CIS Integrations Layer**

  ----------------------------------- ------------- ---------------------------------
  **Component**                       **Status**    **Detail**

  **connector-registry.ts**           **DONE**      OAuth flow management,
                                                    startOAuthFlowForConnector(),
                                                    registry with 6 connectors.

  **oauth-base.ts**                   **DONE**      Abstract OAuthConnector base
                                                    class with local callback server
                                                    pattern.

  **Gmail connector**                 **FILE        Full connector file in
                                      EXISTS**      connectors/gmail.ts.

  **Slack connector**                 **FILE        Full connector file in
                                      EXISTS**      connectors/slack.ts.

  **GitHub connector**                **FILE        Full connector file in
                                      EXISTS**      connectors/github.ts.

  **Notion connector**                **FILE        Full connector file in
                                      EXISTS**      connectors/notion.ts.

  **Reddit connector**                **FILE        Full connector file in
                                      EXISTS**      connectors/reddit.ts.

  **Google Drive connector**          **FILE        Full connector file in
                                      EXISTS**      connectors/google-drive.ts.

  **connections.router.ts**           **FILE        API routes for OAuth flows exist.
                                      EXISTS**      

  **cis-context-builder.ts**          **MISSING**   Intent detection and context
                                                    packet assembly not built.

  **integration-sync.ts**             **MISSING**   Background TTL-based refresh not
                                                    built.

  **Salesforce/HubSpot/Stripe/GA4**   **MISSING**   No connector files for wave 2
                                                    platforms.

  **Instagram/TikTok/X/LinkedIn       **MISSING**   No connector files for social
  APIs**                                            platform OAuth.
  ----------------------------------- ------------- ---------------------------------

**Phase 4 Verdict**

The OAuth infrastructure is solid. 6 connectors exist. The missing
pieces are: the CIS context builder (the brain that decides what
integration data to inject), the background sync engine, and wave 2/3
connectors. The context builder is the highest-value item here.

**1.5 Phase 5: Policy Engine & Audit**

  -------------------------- ------------ ---------------------------------
  **Component**              **Status**   **Detail**

  **policy.ts**              **DONE**     Full PolicyEngine class with
                                          configurable rules,
                                          evaluateAction(), risk scoring,
                                          rule CRUD, default rules for all
                                          tool categories.

  **audit-log.ts**           **DONE**     Append-only JSONL writer,
                                          queryAuditLog() with filtering,
                                          rotation, secret scrubbing.

  **audit-log.router.ts**    **FILE       API routes for querying audit
                             EXISTS**     log.

  **Policy wired into tool   **NEEDS      Policy engine exists but must
  exec**                     WORK**       verify it is called in the tool
                                          execution path (executeTool
                                          wrapper in subagent-executor.ts
                                          or tool-builder.ts).

  **Audit entries on every   **NEEDS      appendAuditEntry() exists but
  tool call**                WORK**       must verify it is called for
                                          every tool execution.
  -------------------------- ------------ ---------------------------------

**Phase 5 Verdict**

Both the policy engine and audit log are fully implemented as standalone
modules. The remaining work is verifying they are wired into the actual
tool execution pipeline.

**2. The Universal Team System**

This is the heart of Prometheus. The team system is not just for
pre-defined workflows. It is the mechanism by which a user can say \"I
want to automate X\" and Prometheus builds and runs a team to do it. Any
X. Here is what that looks like end-to-end.

**2.1 How Teams Work Today**

-   **Main Chat:** User describes what they want to automate in the main
    chat.

-   **Planning:** The main agent and user plan the team structure: which
    agents, what roles, what tools each needs.

-   **Agent Creation:** Main agent creates each agent via spawn_subagent
    (with system_instructions, allowed_tools, and optionally a cron
    schedule).

-   **Team Creation:** Main agent creates the team via
    team_manage(create) referencing those agent IDs.

-   **Execution:** Team manager auto-dispatches tasks to agents. Agents
    execute using their tools.

-   **Review Loop:** Manager reviews results, provides feedback,
    dispatches follow-up rounds.

-   **Delivery:** Results are available in team workspace and team chat.

**2.2 What the Team System Can Already Do**

-   Create teams with any number of agents, each with their own system
    prompt, tools, and schedule.

-   Dispatch tasks to specific agents or let the manager auto-assign.

-   Run multi-round workflows with manager review between rounds.

-   Pause/resume teams, add/remove members, update team context.

-   Context references (files, URLs, notes) shared across team members.

-   Run history tracking per team.

-   One-shot team pattern (deploy-analysis-team.ts).

-   Notification bridge for team-to-main-chat events.

**2.3 What Teams Need to Be Truly Universal**

The team infrastructure is strong. For true universality, we need these
enhancements:

**A. Teams Need Live Integration Access**

Today, team agents can use browser automation to interact with websites,
but they cannot natively read from Gmail, post to Slack, check Stripe
revenue, or push to GitHub. The CIS integration layer gives them this.

-   Each team agent should be able to call integration tools
    (gmail_read, slack_post, stripe_get_revenue, github_create_pr, etc.)
    based on the team permissions.

-   The team creation flow should allow specifying which integrations a
    team has access to.

-   Integration data should be injectable into team agent context
    packets.

**B. Teams Need Content Creation Capabilities**

For social media automation, news channels, content marketing, and
similar use cases, teams need the ability to:

-   Generate text content (already possible via LLM).

-   Generate images via AI image generation tools (DALL-E, Stability, or
    local models).

-   Create short-form video scripts and storyboards.

-   Post content to platforms via integration connectors (Instagram,
    TikTok, X, LinkedIn, YouTube).

-   Schedule content posting via cron or event-driven triggers.

**C. Teams Need Persistent State Across Runs**

A team running a daily social media workflow needs to remember what it
posted yesterday, what performed well, and what the content calendar
looks like. Today:

-   Team workspace files persist across runs (this works).

-   BUSINESS.md and entity files are available (after CIS Phase 1
    wiring).

-   Intraday notes capture task summaries.

What is still needed:

-   Team-scoped memory: a team-specific state file that persists across
    dispatches (team_state.md or similar).

-   Inter-run context injection: when a team agent starts a new
    dispatch, it should automatically receive a summary of what happened
    in the last run.

**D. Website & Social Media Intelligence as Team-Spawnable**

The website analysis team (Phase 2) and social media intelligence (Phase
3) should be invokable as one-shot teams from any context, not just the
main chat.

-   A social media automation team should be able to call
    deploy_social_analysis() to check how recent posts performed.

-   A business operations team should be able to call
    deploy_analysis_team() to audit the company website on demand.

**3. Implementation Plan**

Organized by priority. Each block is independently valuable and
non-breaking. The refactored codebase (routers separated from
server-v2.ts) makes all of these changes safer and more modular.

**Block A: Wire What Exists (1-2 days)**

*These items require zero new logic. The code exists; it just needs to
be connected.*

**A1. Verify conversation-learning.ts is called on session close**

-   Location: routes/chat.router.ts or session.ts lifecycle hooks.

-   Action: Find the session close/cleanup handler and ensure
    extractAndWrite() is called with the message history and workspace
    path.

-   If not wired: add a post-session hook call in the appropriate
    lifecycle method.

**A2. Wire deploy-analysis-team.ts into the runtime**

-   Call injectAnalysisTeamDeps() during server boot in server-v2.ts or
    the startup sequence.

-   Register deploy_analysis_team as a tool in tool-builder.ts
    buildTools().

-   Verify the tool definition matches what the LLM expects (name,
    params, description).

**A3. Wire event polling into the chat response cycle**

-   In routes/chat.router.ts handleChat(), after generating a response,
    call drainPendingEvents(workspacePath).

-   If events exist, format them via formatEventMessage() and inject as
    a system message or append to the response.

**A4. Wire policy engine into tool execution**

-   In the tool execution path (subagent-executor.ts executeTool or
    tool-builder.ts), wrap each call with
    getPolicyEngine().evaluateAction().

-   For READ tier: pass through, log via appendAuditEntry().

-   For PROPOSE tier: return the proposal summary to the user instead of
    executing.

-   For COMMIT tier: route to the existing approval/verification flow.

**A5. Register social_intel tool**

-   Add the social_intel tool definition to tool-builder.ts
    buildTools().

-   Call injectSocialScraperDeps() during boot.

**Block B: Complete Business Brain (1 day)**

*Make Prometheus actually learn and remember business context.*

**B1. Add entity read/write tools**

-   New tool: read_entity(type, id) reads
    workspace/entities/\[type\]/\[id\].md.

-   New tool: write_entity(type, id, content) creates or updates the
    entity file.

-   New tool: list_entities(type?) lists all entities, optionally
    filtered by type.

-   Register all three in tool-builder.ts.

**B2. Update SOUL.md with CIS awareness**

-   Add a new section to SOUL.md explaining BUSINESS.md, entity files,
    and when to update them.

-   Key instructions: check BUSINESS.md for company context, write new
    business facts to BUSINESS.md, create/update entity files when
    learning about clients/projects/contacts.

**B3. Add CIS intent detection to detectToolCategories()**

-   In prompt-context.ts, add a BUSINESS category with keywords: client,
    customer, vendor, project, deal, contract, invoice, team member,
    company, revenue, product.

-   When detected, load relevant entity files (not all, just the ones
    matching detected names in the message).

**Block C: Website Intelligence Polish (1-2 days)**

*Make the one-shot website analysis team production-ready.*

**C1. Test end-to-end flow**

-   Run deploy_analysis_team with a test URL.

-   Verify all 5 agents spawn, write findings files, compiler runs,
    report is generated.

-   Verify notify bridge fires and event appears in main chat.

-   Verify one-shot cleanup deletes the team after delivery.

**C2. Add GEO analysis improvements**

-   Current GEO agent checks web search results. Enhance to query
    Perplexity/ChatGPT APIs if available.

-   Add brand mention counting and AI citation tracking.

**C3. Report template polish**

-   Standardize the report format across all 5 agent findings.

-   Add a scoring summary (SEO: 7/10, Performance: 6/10, etc.) at the
    top of the compiled report.

-   Save report to workspace root (not team workspace) so it persists
    after cleanup.

**Block D: Social Media Intelligence (2-3 days)**

*Full social media coaching capability.*

**D1. Install and test Scrapling**

-   pip install scrapling on the Prometheus host.

-   Create a minimal Python wrapper script that social-scraper.ts calls
    via shell subprocess.

-   Test with a public Instagram/X profile to verify data extraction.

**D2. Add social platform OAuth connectors**

-   Add to connector-registry.ts: InstagramConnector, TikTokConnector,
    XConnector, LinkedInConnector.

-   Each extends OAuthConnector base class with platform-specific OAuth
    URLs, scopes, and token refresh logic.

-   Token storage via vault (same pattern as Gmail/Slack).

**D3. Create social intelligence skill**

-   New skill file in workspace/skills/ with playbooks for: profile
    analysis, post performance ranking, engagement rate calculation,
    optimal posting times, growth trajectory, content recommendations.

-   Platform-specific prompts for Instagram vs TikTok vs X vs LinkedIn.

**D4. Content creation tools for teams**

-   If user has an API key for DALL-E/Stability: register an
    image_generate tool that team agents can call.

-   Content calendar entity: entities/social/content-calendar.md for
    tracking planned/posted content.

-   Posting tools via integration connectors (instagram_post, x_post,
    linkedin_post) with COMMIT tier policy.

**Block E: CIS Context Builder + Integration Sync (3-5 days)**

*The smart layer that makes integrations actually useful in
conversations and team runs.*

**E1. Build cis-context-builder.ts**

-   Intent detection from user message: detects which integrations are
    relevant (e.g., \'check my email\' triggers Gmail, \'how are
    sales?\' triggers Stripe/Salesforce).

-   Builds a scoped context packet: pulls cached data from relevant
    integrations, entity files, and BUSINESS.md.

-   Injects into buildPersonalityContext() as a \[CIS_CONTEXT\] block
    with a hard token budget.

**E2. Build integration-sync.ts**

-   Background scheduler (piggyback on existing heartbeat
    infrastructure).

-   For each connected integration: check if cache TTL has expired, if
    so fetch fresh data and write to
    workspace/integrations/\[platform\]-cache.json.

-   Emit events to pending.json when significant changes are detected
    (new email, new PR, revenue spike, etc.).

**E3. Wave 2 connectors**

-   Salesforce, HubSpot, Stripe, Google Analytics 4.

-   Each follows the existing OAuthConnector pattern.

**E4. Integration tools for team agents**

-   Register integration-specific tools (gmail_read, gmail_draft,
    slack_read, slack_post, stripe_revenue, github_pr_status, etc.).

-   Each tool checks integration permissions before executing.

-   COMMIT-tier tools require approval via policy engine.

**4. Example Team Use Cases**

These illustrate what becomes possible once all blocks are wired.

**4.1 Start a Business From Scratch**

  --------------- -------------------------------------------------------
  **Agent**       **Responsibilities**

  **Architect**   **AGENT**

  **Developer**   **AGENT**

  **Deployer**    **AGENT**

  **Payments**    **AGENT**

  **Content**     **AGENT**

  **Manager**     **REVIEW**
  --------------- -------------------------------------------------------

**4.2 Automated Social Media Channel**

  ---------------- -------------------------------------------------------
  **Agent**        **Responsibilities**

  **Researcher**   **CRON**

  **Writer**       **DISPATCH**

  **Designer**     **DISPATCH**

  **Publisher**    **DISPATCH**

  **Analyst**      **WEEKLY**

  **Manager**      **REVIEW**
  ---------------- -------------------------------------------------------

**4.3 Daily Business Operations Bot**

  --------------- -------------------------------------------------------
  **Agent**       **Responsibilities**

  **Revenue**     **CRON**

  **Inbox**       **CRON**

  **Pipeline**    **CRON**

  **Briefer**     **DISPATCH**

  **Manager**     **REVIEW**
  --------------- -------------------------------------------------------

**4.4 Automated News Channel**

  --------------- -------------------------------------------------------
  **Agent**       **Responsibilities**

  **Scanner**     **CRON**

  **Writer**      **DISPATCH**

  **Publisher**   **DISPATCH**

  **Manager**     **REVIEW**
  --------------- -------------------------------------------------------

**5. File Reference (Post-Refactor Paths)**

Updated paths reflecting the router decomposition. The CIS plan
referenced server-v2.ts for many changes; those have been redistributed.

**5.1 Where Things Live Now**

  ------------------------------- ----------------------------------------
  **CIS Plan Reference**          **Actual Post-Refactor Location**

  **server-v2.ts (chat handler)** **MOVED**

  **server-v2.ts (team routes)**  **MOVED**

  **server-v2.ts (OAuth routes)** **MOVED**

  **server-v2.ts (audit routes)** **MOVED**

  **server-v2.ts (settings)**     **MOVED**

  **server-v2.ts (skills)**       **MOVED**

  **buildPersonalityContext()**   **MOVED**

  **Tool definitions**            **SAME**

  **Tool execution**              **SAME**
  ------------------------------- ----------------------------------------

**5.2 New Files to Create**

  ----------------------------------------------- ------------------------------------
  **File**                                        **Purpose**

  **src/integrations/cis-context-builder.ts**     **PLANNED**

  **src/integrations/integration-sync.ts**        **PLANNED**

  **src/tools/entity-tools.ts**                   **PLANNED**

  **src/integrations/connectors/instagram.ts**    **PLANNED**

  **src/integrations/connectors/tiktok.ts**       **PLANNED**

  **src/integrations/connectors/x.ts**            **PLANNED**

  **src/integrations/connectors/linkedin.ts**     **PLANNED**

  **src/integrations/connectors/salesforce.ts**   **PLANNED**

  **src/integrations/connectors/hubspot.ts**      **PLANNED**

  **src/integrations/connectors/stripe.ts**       **PLANNED**

  **src/integrations/connectors/ga4.ts**          **PLANNED**

  **workspace/skills/social-intelligence.md**     **PLANNED**

  **scripts/scrapling-bridge.py**                 **PLANNED**
  ----------------------------------------------- ------------------------------------

**5.3 Existing Files to Modify**

  ----------------------------------------- ------------------------------------
  **File**                                  **Change**

  **gateway/prompt-context.ts**             **SMALL**

  **gateway/tool-builder.ts**               **SMALL**

  **gateway/server-v2.ts (boot)**           **SMALL**

  **routes/chat.router.ts**                 **SMALL**

  **agents-runtime/subagent-executor.ts**   **SMALL**

  **workspace/SOUL.md**                     **SMALL**

  **integrations/connector-registry.ts**    **SMALL**
  ----------------------------------------- ------------------------------------

**6. Priority Build Order**

Blocks ordered by impact and dependency. Each block unlocks real user
value independently.

  -------- ------------------ ------------ ------------- ---------------------------
  **\#**   **Block**          **Effort**   **Unlocks**   **Dependencies**

  **1**    **Block A: Wire    1-2 days     Everything    None (pure wiring)
           What Exists**                   below         

  **2**    **Block B:         1 day        Persistent    Block A (entity tools need
           Business Brain**                context       registration)

  **3**    **Block C: Website 1-2 days     Site analysis Block A (tool
           Intel**                         team          registration + event
                                                         polling)

  **4**    **Block D: Social  2-3 days     Social        Block A + B (entity
           Intel**                         coaching +    persistence)
                                           posting       

  **5**    **Block E: CIS     3-5 days     Live          Block A + B
           Context Builder**               integration   
                                           context       
  -------- ------------------ ------------ ------------- ---------------------------

+-----------------------------------------------------------------------+
| **BOTTOM LINE**                                                       |
|                                                                       |
| Prometheus is genuinely close to the universal team vision. The CIS   |
| plan was ambitious and the implementation got further than expected.  |
| The critical gap is not missing features but missing wiring. Block A  |
| (1-2 days of pure connection work) unlocks the majority of the value  |
| that has already been built.                                          |
|                                                                       |
| **Total estimated effort to full CIS completion: 8-13 days. But Block |
| A alone makes the system dramatically more capable.**                 |
+-----------------------------------------------------------------------+
