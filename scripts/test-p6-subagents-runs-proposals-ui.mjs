import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = {
  reasoning: read('web-ui/src/components/reasoning-selector.js'),
  capabilities: read('web-ui/src/reasoning-capabilities.js'),
  desktopSubagents: read('web-ui/src/pages/SubagentsPage.js'),
  desktopProposals: read('web-ui/src/pages/ProposalsPage.js'),
  mobilePages: read('web-ui/src/mobile/mobile-pages.js'),
  mobileBadge: read('web-ui/src/mobile/mobile-model-badge.js'),
  mobileApi: read('web-ui/src/mobile/mobile-api.js'),
  chat: read('web-ui/src/pages/ChatPage.js'),
  desktopCss: read('web-ui/src/styles/pages.css'),
  mobileCss: read('web-ui/src/styles/mobile.css'),
  settings: read('src/gateway/routes/settings.router.ts'),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/role="slider"/.test(source.reasoning), 'shared reasoning selector must expose a slider contract');
assert(/ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/.test(source.reasoning), 'shared reasoning selector must support keyboard navigation');
assert(/data-value/.test(source.reasoning) && /aria-valuetext/.test(source.reasoning), 'reasoning options need accessible persisted values');
assert(/reasoningSelectorOptions/.test(source.capabilities) && /formatReasoningSelectorLabel/.test(source.capabilities), 'reasoning terminology must be shared');
assert(/renderReasoningSelector/.test(source.mobileBadge) && /setMobileSubagentReasoningContext/.test(source.mobileBadge), 'mobile subagent chat must reuse the reasoning selector');
assert(/data-subagent-reasoning-trigger/.test(source.desktopSubagents) && /wireReasoningSelector/.test(source.desktopSubagents), 'desktop subagent chat needs the reasoning trigger and wiring');
assert(/\/api\/agents\/\$\{encodeURIComponent\(agentId\)\}\/model/.test(source.desktopSubagents), 'subagent reasoning must persist through the existing agent model route');
assert(/subagent-run-recovery-composer/.test(source.desktopSubagents) && /AbortController/.test(source.desktopSubagents), 'desktop Runs recovery composer needs an abortable composer');
assert(/state\.queue\.length >= 8/.test(source.desktopSubagents), 'desktop recovery composer queue limit is missing');
assert(/data-sa-run-composer/.test(source.mobilePages) && /isBusy: \(\) => state\.busy/.test(source.mobilePages), 'mobile subagent Runs composer must be stateful');
assert(/onAbort:[\s\S]{0,220}state\.controller/.test(source.mobilePages), 'mobile recovery composer must stop its active request');
assert(/pm-sa-run-composer-status/.test(source.mobilePages) && /Uploading/.test(source.mobilePages), 'mobile recovery composer needs loading and error status presentation');
assert(/signal: options\?\.signal/.test(source.mobileApi), 'mobile recovery APIs must accept the active abort signal');
assert(/uploadStagedFilesToCanvas\(stagedFiles = pendingChatFiles, \{ signal \}/.test(source.chat) && /signal,/.test(source.chat), 'shared desktop attachment uploads must honor recovery abort signals');
assert(/isApprovedProposalExecutionStep/.test(source.desktopProposals) && /is-approved/.test(source.desktopProposals), 'desktop approved proposal steps need an approved state class');
assert(/_pmIsApprovedExecutionStep/.test(source.mobilePages) && /is-approved/.test(source.mobilePages), 'mobile approved proposal steps need an approved state class');
assert(/proposal-execution-step\.is-approved/.test(source.desktopCss) && /font-weight: 800/.test(source.desktopCss), 'desktop approved proposal steps must be visibly bold');
assert(/pm-proposal-step\.is-approved/.test(source.mobileCss) && /font-weight: 800/.test(source.mobileCss), 'mobile approved proposal steps must be visibly bold');
assert(/resolveConfiguredAgentModel/.test(source.settings) && /reasoning_effort/.test(source.settings), 'agent reasoning persistence must validate effective default models');

console.log('P6 subagents, Runs, and proposals UI contracts passed.');
