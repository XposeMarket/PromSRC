import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const router = read('web-ui/src/mobile/mobile-router.js');
const api = read('web-ui/src/mobile/mobile-api.js');
const channels = read('src/gateway/routes/channels.router.ts');
const styles = read('web-ui/src/styles/mobile.css');

assert.ok(pages.includes("const tabs = ['Overview', 'Chat', 'Memory', 'Runs', 'Heartbeat']"), 'subagent tabs must use Memory instead of AGENT.md');
assert.ok(pages.includes('function _renderSubagentMemoryTab'), 'Memory tab renderer must exist');
assert.ok(pages.includes('openKey = openKey === key ? \'\' : key'), 'Memory accordion must toggle and keep a single item open');
assert.ok(pages.includes('renderSubagentChatPage'), 'locked subagent Chat renderer must exist');
assert.ok(pages.includes("navigate?.(`#mobile/subagents/${encodeURIComponent(agentId)}/chat`)"), 'Chat selection must navigate to the dedicated route');
assert.ok(pages.includes("onBack: () => navigate?.(`#mobile/subagents/${encodeURIComponent(agentId)}`)"), 'locked Chat back button must return to Overview');
assert.ok(router.includes("String(extra?.[0] || '').toLowerCase() === 'chat'"), 'router must route /subagents/:id/chat to locked chat');
assert.ok(api.includes('/memory-md'), 'mobile API must load the per-agent memory endpoint');
assert.ok(channels.includes("router.get('/api/agents/:id/memory-md', getAgentMemoryMd)"), 'gateway must expose the canonical per-agent memory endpoint');
assert.ok(channels.includes('fileChanges: result?.fileChanges || undefined') && channels.includes('richArtifacts: Array.isArray(result?.richArtifacts)'), 'subagent history must persist completed-turn file and artifact presentation data');
assert.ok(channels.includes('fileChanges: payload.result?.fileChanges') && channels.includes('richArtifacts: payload.result?.richArtifacts'), 'subagent stream completion must deliver file and artifact presentation data');
assert.ok(styles.includes('body.pm-mobile-active.pm-mobile-document-scroll .pm-body.pm-subagent-chat-body'), 'locked Chat must override document scrolling');
assert.ok(styles.includes('pm-mobile-subagent-chat-locked') && styles.includes('overflow: hidden;'), 'locked Chat must disable the outer document scroller for this route');
assert.ok(styles.includes('.pm-subagent-chat-body {\n  display: flex;\n  flex-direction: column;\n  height: 100dvh;'), 'locked Chat viewport must be measured once from the full viewport');
assert.ok(styles.includes('position: fixed !important;') && styles.includes('--pm-sa-chat-composer-space'), 'locked Chat composer must stay fixed above the tab bar with matching reading clearance');
assert.ok(pages.includes('function scrollToLatest()') && pages.includes('setTimeout(pin, 80);'), 'subagent history must pin to the newest message after layout settles');
assert.ok(pages.includes("document.body.classList.add('pm-mobile-subagent-chat-locked')") && pages.includes('historyResizeObserver = new ResizeObserver'), 'locked Chat must hold the newest message through its initial async layout');
assert.ok(pages.includes('function _normalizeCollapsedAgentMarkdown') && pages.includes('_renderMobileMarkdown(markdownText)'), 'subagent responses must recover flattened Markdown headings and lists before rendering');
assert.ok(pages.includes("window.addEventListener('prometheus:markdown-ready', onMarkdownReady)") && pages.includes("window.removeEventListener('prometheus:markdown-ready', onMarkdownReady)"), 'subagent history must re-render after the Markdown library becomes available');
assert.ok(pages.includes('function _mobileAgentTurnPresentation') && pages.includes('_renderMobileFileChanges(_mobileAgentMessageFileChanges(turnPresentation))'), 'subagent bubbles must rehydrate persisted touched-file cards');
assert.ok(pages.includes('_renderMobileRichArtifacts(turnPresentation)') && pages.includes('_renderMobileMediaGallery(_collectMessageMedia({'), 'subagent bubbles must render the same finalized artifacts and media as main chat');
assert.ok(pages.includes('attachStream?.(null);'), 'completed or aborted streams must be detached before route cleanup');

const normalizerStart = pages.indexOf('function _normalizeCollapsedAgentMarkdown');
const normalizerEnd = pages.indexOf('\nfunction _renderMobileAgentChatBubble', normalizerStart);
assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart, 'collapsed Markdown normalizer source must be extractable');
const normalizeCollapsedAgentMarkdown = Function(`${pages.slice(normalizerStart, normalizerEnd)}; return _normalizeCollapsedAgentMarkdown;`)();
assert.equal(
  normalizeCollapsedAgentMarkdown('Completed. ### Delivered - First item - Second item'),
  'Completed.\n\n### Delivered\n- First item\n- Second item',
  'collapsed subagent Markdown must regain heading and list block boundaries',
);

const presentationStart = pages.indexOf('function _mobileAgentTurnPresentation');
const presentationEnd = pages.indexOf('\nfunction _voiceMessageMeta', presentationStart);
assert.ok(presentationStart >= 0 && presentationEnd > presentationStart, 'subagent turn presentation source must be extractable');
const mobileAgentTurnPresentation = Function(`${pages.slice(presentationStart, presentationEnd)}; return _mobileAgentTurnPresentation;`)();
const hydratedTurn = mobileAgentTurnPresentation({ metadata: { fileChanges: { files: [{ path: 'src/example.ts' }] }, richArtifacts: [{ type: 'sources', items: [] }] } });
assert.equal(hydratedTurn.fileChanges.files[0].path, 'src/example.ts', 'reopened subagent history must retain touched files');
assert.equal(hydratedTurn.richArtifacts[0].type, 'sources', 'reopened subagent history must retain rich artifacts');
console.log('mobile subagent Memory accordion and locked Chat route contract: ok');
