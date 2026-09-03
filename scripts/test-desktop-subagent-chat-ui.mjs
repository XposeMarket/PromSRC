import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const subagents = read('web-ui/src/pages/SubagentsPage.js');
const teams = read('web-ui/src/pages/TeamsPage.js');
const chat = read('web-ui/src/pages/ChatPage.js');
const index = read('web-ui/index.html');
const performance = read('web-ui/src/performance.js');
const performanceGenerated = read('generated/public-web-ui/static/performance.js');
const canonical = read('web-ui/src/features/chat/canonical-desktop-composer.js');
const canonicalGenerated = read('generated/public-web-ui/static/features/chat/canonical-desktop-composer.js');
const themes = read('web-ui/src/styles/themes.css');
const components = read('web-ui/src/styles/components.css');
const promBotCollab = read('web-ui/src/prom-bot-collab.js');
const workspaceTree = read('web-ui/src/components/workspace-file-tree.js');
const workspaceTreeGenerated = read('generated/public-web-ui/static/components/workspace-file-tree.js');
const workspaceCss = read('web-ui/src/styles/workspace-file-tree.css');
const workspaceCssGenerated = read('generated/public-web-ui/static/styles/workspace-file-tree.css');
const channelsRouter = read('src/gateway/routes/channels.router.ts');
const teamsRouter = read('src/gateway/routes/teams.router.ts');
const modelPicker = read('web-ui/src/components/agent-model-picker.js');

assert.match(
  subagents,
  /const isChat = subagentDetailTab === 'chat';[\s\S]*?header\.hidden = isChat;[\s\S]*?header\.style\.display = isChat \? 'none' : 'flex';/,
  'the outer subagent board header must be hidden while direct chat is active',
);
assert.match(
  subagents,
  /function closeUnifiedSubagentChat\(agentId\) \{[\s\S]*?captureSubagentChatDraft\(\);[\s\S]*?subagentDetailTab = 'overview';/,
  'the chat exit control must capture the draft before returning to Overview',
);
assert.match(
  subagents,
  /onclick="closeUnifiedSubagentChat\(\$\{agentArg\}\)"/,
  'the unified chat header must own a safe return-to-overview control',
);
assert.match(
  subagents,
  /voiceAction: "toggleUnifiedDesktopComposerDictation\('subagent-chat-input', this\)"/,
  'subagent voice input must use the shared desktop dictation behavior',
);

const chatTab = subagents.match(/function renderSubagentChatTab\(agent\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(chatTab, /return renderSubagentUnifiedDesktopChat\(agent\);/);
assert.doesNotMatch(chatTab, /chat-input-area panel-chat-composer/);

// The page-specific renderers still own state/transport adapters, but their
// visible composer is NOT allowed to be a separately styled implementation.
assert.match(subagents, /renderer\.renderComposer\(\{/);
assert.match(teams, /renderer\.renderComposer\(\{/);
assert.match(subagents, /sessionId:\s*getSubagentChatSessionId\(agent\.id\)/,
  'standalone subagent chat must give the shared composer its session identity');
assert.match(subagents, /secondarySurface:\s*'subagent-chat'/,
  'standalone subagent chat must identify its secondary composer surface');
assert.match(teams, /sessionId:\s*`team_chat_\$\{team\.id\}`/,
  'standalone team chat must give the shared composer its session identity');
assert.match(teams, /secondarySurface:\s*'team-chat'/,
  'standalone team chat must identify its secondary composer surface');
assert.match(chat, /window\.__PROM_UNIFIED_DESKTOP_CHAT = \{/);
assert.match(chat, /renderComposer: renderUnifiedDesktopComposerHtml/);
assert.match(promBotCollab, /renderer\.renderComposer\(\{[^}]*sessionId, secondarySurface:\s*'prom-bot-group'/s,
  'Prom Bot group chat must use the shared session-aware composer');

assert.equal(performance, performanceGenerated, 'performance source/generated copies must match');
assert.equal(canonical, canonicalGenerated, 'canonical composer source/generated copies must match');
assert.equal(workspaceTree, workspaceTreeGenerated, 'workspace file tree source/generated copies must match');
assert.equal(workspaceCss, workspaceCssGenerated, 'workspace file tree CSS source/generated copies must match');
assert.match(performance, /import\('\.\/features\/chat\/canonical-desktop-composer\.js'\)/,
  'desktop bootstrap must install canonical main-composer reuse');

// One visual source of truth: clone the composer already mounted in #chat-view.
assert.match(index, /<div class="chat-input-area">[\s\S]*?<div class="chat-input-row">[\s\S]*?class="chat-composer-input-wrap"/,
  'main chat composer DOM contract changed unexpectedly');
assert.match(index, /id="chat-composer-input-wrap"/,
  'main composer input wrapper identity changed; clone isolation contract must be revisited');
assert.match(canonical, /MAIN_COMPOSER_SELECTOR = '#chat-view > \.chat-input-area/);
assert.match(canonical, /const clone = main\.cloneNode\(true\)/,
  'secondary composers must reuse the actual main composer DOM');
assert.match(canonical, /clone\.querySelectorAll\('\[id\]'\)\.forEach\(\(node\) => node\.removeAttribute\('id'\)\)/,
  'cloned main-only ids must be stripped before restoring secondary identities');
assert.match(canonical, /clone\.dataset\.canonicalComposerSource = 'main-chat-dom'/);
assert.match(canonical, /clone\.classList\.add\('canonical-secondary-desktop-composer'\)/,
  'session-aware secondary composers must opt into the main desktop layout rules');
assert.match(canonical, /DESKTOP_MESSAGE_SCROLLER_SELECTOR/,
  'secondary composer clearance must target every desktop message scroller');
assert.match(canonical, /ResizeObserver[\s\S]*syncDesktopComposerLayout/,
  'composer growth must update the reserved message clearance');
assert.match(canonical, /team-chat-mention-popover[\s\S]*inputWrap\.appendChild/,
  'canonical team composers must retain the @mention popover behavior');
assert.match(themes, /\.chat-input-area\.canonical-secondary-desktop-composer\s*\{[\s\S]*?grid-template-areas:/,
  'secondary composers must receive the main desktop grid without restoring legacy chrome');
assert.match(themes, /\.chat-input-area\.canonical-secondary-desktop-composer\s*\{[\s\S]*?width:\s*min\(var\(--chat-content-max-width\), calc\(100% - var\(--chat-content-inline-gutter\) - var\(--chat-content-inline-gutter\)\)\)/,
  'secondary composers must use the full shared chat-column width contract');
assert.match(themes, /:is\(\.side-chat-main-pane, \.side-chat-pane, \.unified-agent-chat-shell[\s\S]*?linear-gradient\(180deg, #090909/,
  'Prometheus One secondary chats must use the theme surface instead of the legacy chat background image');
assert.match(themes, /data-background-visuals="off"[^\n]*:is\([^\n]*\.unified-agent-chat-shell[^\n]*#prom-bot-main-surface[^\n]*#prom-bot-group-host/,
  'appearance-off must cover standalone and Prom Bot chat hosts');
assert.match(themes, /data-background-visuals="on"\]\[data-skin="dark"[^\n]*:is\([^\n]*\.unified-agent-chat-shell[^\n]*#prom-bot-main-surface[^\n]*#prom-bot-group-host/,
  'appearance-on must cover standalone and Prom Bot chat hosts');
assert.match(themes, /:is\(main\.main-shell, #chat-view, \.side-chat-main-pane, \.side-chat-pane, \.unified-agent-chat-shell, #prom-bot-main-surface, #prom-bot-group-host\)\s*\{[\s\S]*?background-image: none !important/,
  'final desktop theme surface must also cover secondary chat hosts');
assert.match(components, /#chat-messages\s*\{[\s\S]*?scroll-padding-bottom:\s*var\(--desktop-composer-clearance/,
  'main desktop history must reserve space below the composer');
assert.match(components, /\.unified-agent-chat-messages\s*\{[\s\S]*?scroll-padding-bottom:\s*var\(--desktop-composer-clearance/,
  'unified secondary history must reserve space below the composer');
assert.match(components, /\.workflow-transition-avatar/,
  'subagent identity rows must have a dedicated avatar slot');
assert.match(themes, /\[data-skin="blue"\], \[data-skin="purple"\][\s\S]*?\.msg\.user \.msg-body[\s\S]*?background:\s*var\(--composer-bg\) !important/,
  'blue and purple user bubbles must use the composer surface');
assert.match(subagents, /workflowAvatarHtml:\s*renderSubagentWorkflowAvatar/,
  'direct subagent history/live rows must carry the left-panel identity icon');
assert.match(teams, /workflowAvatarHtml:\s*renderTeamWorkflowAvatar/,
  'team history/live rows must carry the team identity icon');
assert.match(teams, /const managerId = getTeamManagerId\(team\);[\s\S]*?Manager[\s\S]*?Subagents \(\$\{agentIds\.length\}\)/,
  'team subagent controls must expose the manager above the subagent list');
assert.match(teams, /const tabs = \['overview','memory','heartbeat'\]/,
  'team agent detail must use the shared read-only Memory tab');
assert.match(teams, /memory-md/,
  'team agent detail must load team-scoped MEMORY.md');
assert.match(teams, /isManager \? `triggerManagerReview\('/,
  'the Manager row must trigger manager review instead of subagent dispatch');
assert.doesNotMatch(teams, /labels = \{ overview:'Overview', systemprompt:'AGENT\.md'/,
  'team subagent detail must not expose the old AGENT.md tab');
assert.match(teamsRouter, /function resolveTeamAgentIdentity[\s\S]*?ensureManagedTeamManagerAgent/,
  'team identity routes must resolve both managers and subagents');
assert.match(teamsRouter, /router\.get\('\/api\/teams\/:id\/agents\/:agentId\/memory-md'/,
  'gateway must expose team-scoped MEMORY.md');
assert.match(modelPicker, /effectiveModelProvider/,
  'agent model picker must surface the resolved provider for bare model overrides');
assert.match(modelPicker, /const provider = parsed\.provider \|\| \(explicitRaw && effectiveProvider/,
  'agent model picker must preserve provider selection for legacy bare models');
assert.match(promBotCollab, /workflowAvatarHtml:\s*PROM_BOT_WORKFLOW_ICON/,
  'Prom Bot group rows must carry the Prom Bot sidebar icon');
assert.match(promBotCollab, /async function renderGroupRoom\(\{ forceBottom = false \}/,
  'Prom Bot group rerenders must preserve the reading anchor');
assert.match(subagents, /restoreSubagentChatScroll\(chatScrollSnapshot, \{ forceBottom: force \}\)/,
  'subagent streaming refreshes must not unconditionally jump a scrolled user');
assert.match(teams, /const wasNearBottom = messagesBefore[\s\S]*?Math\.min\(previousScrollTop/,
  'team streaming refreshes must not unconditionally jump a scrolled user');

// Cover every legacy desktop entry point the user can actually see.
assert.match(canonical, /\.side-chat-composer\.chat-input-area/,
  'legacy side chats must be replaced with the canonical main composer');
assert.match(canonical, /\.unified-agent-chat-composer\.chat-input-area/,
  'subagent/team chats must be replaced with the canonical main composer');
assert.match(subagents, /composerClass:\s*'unified-agent-chat-composer subagent-panel-chat-composer'/,
  'subagent entry point changed; canonical selector coverage must be updated');
assert.match(teams, /composerClass:\s*'unified-agent-chat-composer team-chat-unified-composer'/,
  'team entry point changed; canonical selector coverage must be updated');
assert.match(chat, /composerClass:\s*'side-chat-composer'/,
  'legacy side-chat entry point changed; canonical selector coverage must be updated');

// Never put the classes that trigger the old panel geometry on the replacement.
assert.match(canonical, /clone\.className = 'chat-input-area unified-desktop-chat-composer'/);
assert.match(components, /body:not\(\.pm-mobile-active\) :is\([\s\S]*?\.unified-agent-chat-composer\.chat-input-area[\s\S]*?\):not\(\[data-canonical-secondary-composer="1"\]\)\s*\{[\s\S]*?display:\s*none !important/,
  'legacy secondary composers must be hidden before the canonical adapter replaces them');
assert.doesNotMatch(canonical, /clone\.classList\.add\([^\n]*(?:side-chat-composer|unified-agent-chat-composer|subagent-panel-chat-composer|team-chat-unified-composer)/,
  'legacy geometry classes must never be re-added to the visible composer');
assert.doesNotMatch(canonical, /width:\s*min\(760px|calc\(100% - 52px\)/,
  'canonical reuse must not recreate legacy composer geometry');

// Teams and direct standalone/Prom Bot chats must expose the same actual
// workspace tree surface. The Prom Bot shell reuses the standalone board, so
// its Workspace action must lead to the agent-owned workspace tab.
assert.match(teams, /renderWorkspaceFileTree/);
assert.match(teams, /bindWorkspaceFileTree/);
assert.match(teams, /prom-workspace-file-tree-layout/);
assert.match(subagents, /case 'workspace':\s+return renderSubagentWorkspaceTab/);
assert.match(subagents, /api\(`\/api\/agents\/\$\{encodeURIComponent\(agentId\)\}\/workspace`\)/);
assert.match(subagents, /side-chat-workspace-button/);
assert.match(workspaceTree, /ArrowDown/);
assert.match(workspaceTree, /ArrowRight/);
assert.match(workspaceTree, /data-file-tree-folder/);
assert.match(channelsRouter, /router\.get\('\/api\/agents\/:id\/workspace'/);
assert.match(channelsRouter, /router\.get\('\/api\/agents\/:id\/workspace\/:filename'/);
assert.match(channelsRouter, /router\.post\('\/api\/agents\/:id\/workspace\/:filename'/);
assert.match(channelsRouter, /Workspace path escapes the agent workspace/);

console.log('desktop subagent/team/side composer contract: visible surfaces reuse the real main composer DOM without duplicate main ids');
