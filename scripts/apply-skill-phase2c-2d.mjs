import fs from 'node:fs';
import path from 'node:path';

const skills = path.resolve('workspace/skills');
const manifests = path.join(skills, '.manifests');
const verified = '2026-07-12';

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function mergeManifest(id, patch) {
  const file = path.join(manifests, `${id}.skill.json`);
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  writeJson(file, { ...current, ...patch });
}

const frontendNativePath = path.join(skills, 'frontend-quality-guard', 'skill.json');
const frontendNative = JSON.parse(fs.readFileSync(frontendNativePath, 'utf8'));
writeJson(frontendNativePath, {
  ...frontendNative,
  id: 'frontend-quality-guard',
  name: 'Frontend Quality Guard',
  description: 'Apply anti-slop design standards and responsive browser QA whenever Prometheus creates or changes any frontend surface.',
  triggers: [
    'build this frontend', 'create a web interface', 'make a quick web page', 'update the frontend',
    'fix the ui', 'polish this screen', 'responsive layout', 'mobile layout bug',
    'frontend component', 'visual qa', 'remove ai slop', 'make a quick html page',
  ],
});

mergeManifest('frontend-quality-guard', {
  schemaVersion: 'prometheus-skill-bundle-v1',
  id: 'frontend-quality-guard',
  entrypoint: 'SKILL.md',
  categories: ['frontend', 'design', 'browser', 'quality'],
  triggers: [
    'build this frontend', 'create a web interface', 'make a quick web page', 'update the frontend',
    'fix the ui', 'polish this screen', 'responsive layout', 'mobile layout bug',
    'frontend component', 'visual qa', 'remove ai slop', 'make a quick html page',
  ],
  requiredTools: ['workspace_write', 'browser_automation'],
  status: 'ready',
  lifecycle: 'active',
  implicitInvocation: true,
  health: {
    state: 'ready',
    reason: 'Bundled Vite template installed and built successfully; static audit, desktop/mobile browser QA, responsive overflow checks, search/filter interactions, and console checks passed.',
    verifiedCapabilities: ['vite_template_install', 'vite_build', 'frontend_static_audit', 'desktop_browser_qa', 'mobile_browser_qa', 'responsive_overflow', 'primary_interactions', 'console_error_check'],
    blockedCapabilities: {},
    lastVerified: verified,
  },
});

mergeManifest('web-scraper', {
  schemaVersion: 'prometheus-skill-bundle-v1',
  id: 'web-scraper',
  name: 'Web Research and Extraction',
  entrypoint: 'SKILL.md',
  categories: ['web', 'research', 'browser', 'extraction'],
  triggers: ['search and fetch sources', 'fetch these web pages', 'scrape this site', 'extract this full page', 'collect listings from this page', 'scroll and collect this page', 'extract structured website data', 'read this javascript page'],
  requiredTools: ['web', 'browser_automation'],
  status: 'ready',
  lifecycle: 'active',
  implicitInvocation: true,
  health: {
    state: 'ready',
    reason: 'Prometheus-native page text, JavaScript-rendered structured extraction, missing-field handling, and full-page scroll collection passed against a permitted local fixture.',
    verifiedCapabilities: ['web_tool_routing', 'browser_get_page_text', 'browser_extract_structured', 'browser_scroll_collect', 'javascript_rendered_content', 'missing_field_nulls', 'full_page_collection'],
    blockedCapabilities: {},
    lastVerified: verified,
  },
});

mergeManifest('git-workflow', {
  status: 'ready',
  implicitInvocation: true,
  health: {
    state: 'ready',
    reason: 'Disposable bare-remote tests passed for clone, tracking, push, fetch, fast-forward pull, commits, tags, logs, diffs, and clean-worktree verification.',
    verifiedCapabilities: ['git_status', 'git_log', 'git_diff', 'git_commit', 'git_branch', 'git_tag', 'git_clone', 'git_push', 'git_fetch', 'git_pull_ff_only', 'remote_tracking'],
    blockedCapabilities: {},
    lastVerified: verified,
  },
});

mergeManifest('ai-surface-smoke-research', {
  name: 'AI Surface Browser and Desktop Smoke Test',
  triggers: ['ai surface smoke test', 'browser desktop smoke test', 'voice browser desktop test', 'test voice tools', 'focus chatgpt and claude', 'search x and test desktop focus', 'run the ai browser test', 'search reddit and x for ai chatter'],
  status: 'ready',
  implicitInvocation: true,
  health: {
    state: 'ready',
    reason: 'Shared voice/typed workflow verified through live Prometheus browser extraction, ChatGPT discovery/window focus, and explicit Claude-missing recovery.',
    verifiedCapabilities: ['voice_tool_parity', 'browser_open', 'browser_scroll_collect', 'chatgpt_app_discovery', 'chatgpt_window_focus', 'claude_app_discovery', 'missing_window_recovery'],
    blockedCapabilities: {},
    lastVerified: verified,
  },
});

mergeManifest('voice-browser-desktop-smoke-test', {
  description: 'Deprecated compatibility entry; use ai-surface-smoke-research for typed or voice-triggered browser/desktop smoke tests.',
  triggers: [],
  categories: ['compatibility'],
  requiredTools: [],
  status: 'ready',
  lifecycle: 'deprecated',
  implicitInvocation: false,
  health: { state: 'ready', reason: 'Merged into ai-surface-smoke-research because voice agents use the same browser and desktop tools.', verifiedCapabilities: ['compatibility_redirect'], blockedCapabilities: {}, lastVerified: verified },
});

const staleFrontendManifest = path.join(manifests, 'codex-frontend-engineer.skill.json');
if (fs.existsSync(staleFrontendManifest)) fs.rmSync(staleFrontendManifest);

console.log('Applied Phase 2C/2D skill metadata and compatibility migration.');
