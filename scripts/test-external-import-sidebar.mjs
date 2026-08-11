import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'web-ui', 'index.html'), 'utf8');
const chatPage = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'ChatPage.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'SettingsPage.js'), 'utf8');
const settingsCss = fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'settings.css'), 'utf8');
const componentCss = fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'components.css'), 'utf8');
const projectsCss = fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'projects.css'), 'utf8');
const mobileApi = fs.readFileSync(path.join(root, 'web-ui', 'src', 'mobile', 'mobile-api.js'), 'utf8');
const mobileShell = fs.readFileSync(path.join(root, 'web-ui', 'src', 'mobile', 'mobile-shell.js'), 'utf8');
const mobilePages = fs.readFileSync(path.join(root, 'web-ui', 'src', 'mobile', 'mobile-pages.js'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'mobile.css'), 'utf8');
const pairingRouter = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'pairing.router.ts'), 'utf8');

for (const [key, label, asset] of [
  ['chatgpt', 'ChatGPT', 'chatgpt.svg'],
  ['codex', 'OpenAI', 'openai.svg'],
  ['openai', 'OpenAI', 'openai.svg'],
  ['claude', 'Claude', 'claude.svg'],
  ['cursor', 'Cursor', 'cursor.svg'],
  ['hermes', 'Hermes', 'nous-research.png'],
  ['openclaw', 'OpenClaw', 'openclaw.svg'],
  ['localclaw', 'LocalClaw', 'localclaw.webp'],
]) {
  assert.match(html, new RegExp(`${key}:[\\s\\S]*?label: '${label}'`), `${label} must be data-driven in the sidebar map`);
  assert.ok(html.includes(`/static/assets/import-sources/${asset}`), `${label} asset must be locally packaged`);
  assert.ok(fs.existsSync(path.join(root, 'web-ui', 'src', 'assets', 'import-sources', asset)), `${asset} must exist`);
}

assert.ok(html.includes('function renderImportedSourceMeta'), 'sidebar must have an imported-source renderer');
assert.ok(!html.includes('if (_isImportedSession(session)) return \'\';'), 'imported rows must retain the normal timestamp metadata');
assert.ok(html.includes('function renderImportedSourceLogo'), 'sidebar must render source identity beside imported titles');
assert.ok(html.includes("'codex-local': { key: 'openai'"), 'Codex local imports must use the OpenAI source mark');
assert.ok(html.includes("openai_codex: { key: 'openai'"), 'OpenAI Codex provenance must use the OpenAI source mark');
assert.ok(!html.includes('Imported:</span>'), 'sidebar must not render the old imported metadata label');
assert.ok(html.includes('function _isImportedSession'), 'sidebar must identify imported sessions for desktop styling');
assert.ok(html.includes('function beginSidebarSessionDrag'), 'sidebar threads must support drag start');
assert.ok(html.includes('function dropSidebarSession'), 'sidebar threads must support drop reorder');
assert.ok(html.includes("fetch('/api/sessions/reorder'"), 'sidebar order must persist through the gateway');
assert.ok(html.includes('const sidebarOrder = Number(s?.sidebarOrder)'), 'sidebar must prefer durable manual order');
assert.ok((html.match(/draggable="true"/g) || []).length >= 3, 'all desktop session row renderers must be draggable');
assert.ok(html.includes('aria-label="${escHtml(ariaLabel)}"'), 'imported source logo must expose accessible labelling');
assert.ok(html.includes('onerror="this.hidden=true;this.nextElementSibling.hidden=false"'), 'logo failure must have a text fallback');
assert.equal((html.match(/renderImportedSourceMeta\(s,/g) || []).length, 3, 'all desktop thread-row timestamp sites must use the helper');
assert.ok(html.includes('timeAgo(normalTimestamp ??'), 'normal sessions must retain timestamp rendering');
assert.ok(chatPage.includes('externalImport: normalizeExternalImportSummary(s.externalImport)'), 'server summaries must retain import provenance');
assert.ok(chatPage.includes('externalImport: serverStub.externalImport || existing.externalImport || null'), 'summary merges must retain import provenance');
assert.ok(settings.includes("if (tab === 'migration')"), 'legacy Migration navigation must be handled');
assert.ok(settings.includes("tab = 'system'"), 'legacy Migration navigation must redirect to General');
assert.ok(settings.includes('function loadExternalImportDiscovery'), 'General settings must load automatic local-source discovery');
assert.ok(settings.includes("api('/api/imports/discover'"), 'settings must use the read-only discovery endpoint');
assert.ok(settings.includes('function previewDiscoveredExternalImport'), 'detected sources must build previews through the existing import flow');
assert.ok(settings.includes('Preview projects + chats'), 'project-capable sources must expose a project import preview action');
assert.ok(settings.includes('previewDiscoveredExternalImportBatches'), 'large Codex sources must expose bounded batch previews');
assert.ok(settings.includes('Confirm selected chats'), 'Codex batches must have one explicit selection-based commit confirmation');
assert.ok(settings.includes('selectedConversationIds') || settings.includes('conversationIds'), 'chat selection must be carried to the import confirmation');
assert.ok(settings.includes('newest first'), 'chat previews must advertise newest-first ordering');
assert.ok(settings.includes('settings-import-project-group'), 'project-capable previews must group chats under expandable projects');
assert.ok(settings.includes('settings-import-view-tabs'), 'project previews must separate project and top-level chat views');
assert.ok(settings.includes('settings-import-history-list'), 'rollback controls must live in a separate import history panel');
assert.ok(html.includes('Import MCP integrations'), 'the right-hand flow must be MCP integration focused');
assert.ok(!settings.includes('historical events'), 'historical event counts must not be shown in the import preview UI');
for (const id of ['settings-external-import', 'settings-import-conversation-path', 'settings-import-setup-path', 'settings-import-conversation-job', 'settings-import-setup-job', 'settings-import-history', 'settings-import-history-list']) {
  assert.ok(html.includes(`id="${id}"`), `${id} must be present in General settings`);
}
for (const id of ['settings-import-conversation-mode', 'settings-import-conversation-adapter', 'settings-import-conversation-account', 'settings-import-setup-label', 'settings-import-setup-overwrite']) {
  assert.ok(!html.includes(`id="${id}"`), `${id} must not remain in the automatic import UI`);
}
assert.ok(settings.includes('function toggleExternalImportProject'), 'project selection must support whole-project selection');
for (const fn of ['previewExternalImportJob', 'previewDiscoveredExternalImportBatches', 'confirmExternalImportJob', 'confirmExternalImportBatchJob', 'confirmExternalImportBatches', 'retryExternalImportJob', 'retryExternalImportBatchJob', 'rollbackExternalImportJob', 'rollbackExternalImportBatchJob', 'deleteExternalImportJob']) {
  assert.ok(settings.includes(`window.${fn} = ${fn}`), `${fn} must be exposed to the settings shell`);
}
assert.ok(mobileApi.includes('externalImport:'), 'mobile session summaries must retain import provenance');
assert.ok(mobileShell.includes('MOBILE_IMPORTED_SOURCE_BRANDS'), 'mobile source logos must use a data-driven brand map');
assert.ok(mobileShell.includes("'codex-local': { key: 'openai'"), 'mobile Codex imports must use the OpenAI source mark');
assert.ok(mobileShell.includes("localclaw: { key: 'localclaw'"), 'mobile LocalClaw imports must use the LocalClaw source mark');
assert.ok(mobileShell.includes('pm-session-import-logo'), 'mobile rows must render a compact source logo');
assert.ok(mobileShell.includes('pm-session-time'), 'mobile rows must render last-message timestamps');
assert.ok(mobileShell.includes('pm-session-subline'), 'mobile rows must keep source metadata and timestamp on one compact line');
assert.ok(mobileCss.includes('pm-session-import-logo'), 'mobile source logos need compact title-line styling');
assert.ok(mobileCss.includes('pm-session-subline'), 'mobile rows need compact secondary-line styling');
assert.ok(mobileCss.includes('pm-session-meta-row .pm-session-time'), 'mobile timestamps must stay on the lower metadata line');
assert.ok(mobileCss.includes('width: 14px'), 'mobile source logos must stay small');
assert.ok(!mobileShell.includes("'No messages yet'"), 'mobile session rows must not show the empty-chat placeholder');
const targetProjectLabelDeclaration = mobilePages.indexOf('let targetProjectLabel');
const targetProjectLabelUse = mobilePages.indexOf('targetProjectLabel ||');
assert.ok(targetProjectLabelDeclaration >= 0 && targetProjectLabelDeclaration < targetProjectLabelUse, 'mobile chat target project label must be initialized before its template use');
assert.ok(pairingRouter.includes('externalImport:'), 'mobile gateway catalog must preserve compact import provenance');
assert.ok(pairingRouter.includes('externalSource.provider'), 'mobile gateway catalog must expose source brand identity safely');
assert.ok(settingsCss.includes('.settings-import-grid'), 'General import cards need responsive settings styles');
assert.ok(settingsCss.includes('.settings-import-discovery'), 'General settings need the automatic discovery panel styles');
assert.ok(componentCss.includes('.imported-source-logo'), 'sidebar logo needs compact row styling');
assert.ok(componentCss.includes('.chat-session-item.imported-session-card'), 'desktop imported rows need distinct sizing');
assert.ok(componentCss.includes('grid-template-columns: 24px minmax(0, 1fr)'), 'imported logos and titles must stay adjacent');
assert.ok(componentCss.includes('#jobs-list'), 'regular chat rows must share the pinned chat left inset');
assert.ok(fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'projects.css'), 'utf8').includes('#projects-list { padding: 4px 10px 12px 0; }'), 'project rows must share the sidebar left inset');
assert.ok(componentCss.includes('background: transparent'), 'source logos must render without a surrounding panel');
assert.ok(projectsCss.includes('.project-chat-icon-line .imported-source-logo'), 'imported project rows must show the source logo');

console.log('external import sidebar contract: ok');
