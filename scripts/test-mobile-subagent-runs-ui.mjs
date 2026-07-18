import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const pages = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionSource(name, nextName) {
  const start = pages.indexOf(`function ${name}(`);
  const end = [
    pages.indexOf(`\nfunction ${nextName}(`, start),
    pages.indexOf(`\nasync function ${nextName}(`, start),
  ].filter((index) => index > start).sort((a, b) => a - b)[0];
  assert(start >= 0 && end > start, `could not isolate ${name}`);
  return pages.slice(start, end);
}

assert(/function _mobileRunPresentationTitle/.test(pages), 'run titles need a presentation-only normalizer');
assert(/_mobileRunPresentationTitle[\s\S]{0,260}subagent\|agent/.test(pages), 'internal [Subagent] prefixes must not reach the Runs card');
assert(/function _mobileRunArtifactPresentation/.test(pages), 'artifact metadata needs a dedicated parser');
assert(/SHA-\?256/.test(pages), 'artifact parser must recognize SHA-256 values');
assert(/_renderMobileMarkdown\(visibleProse\)/.test(pages), 'run summaries must render Markdown instead of escaped source');
assert(/pm-sa-run-artifact/.test(pages) && /data-sa-run-copy/.test(pages), 'artifact metadata must be compact and copyable');
assert(/_copyMobileSnippetText\(button\.getAttribute\('data-sa-run-copy'\)/.test(pages), 'artifact copy controls must be wired');
assert(/\.pm-subagent-detail-body \{[\s\S]*?padding-bottom: calc\(var\(--pm-tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 52px\)/.test(css), 'Runs detail must reserve bottom navigation and safe-area space');
assert(/\.pm-sa-run-summary,[\s\S]*?overflow-wrap: anywhere/.test(css), 'long unbroken summary strings must wrap');
assert(/\.pm-sa-run-summary pre,[\s\S]*?overflow: auto/.test(css), 'long code blocks need bounded scrolling');
assert(/\.pm-sa-run-artifact-path[\s\S]*?word-break: break-word/.test(css), 'long artifact paths and hashes must not overflow cards');

const presentationContext = {
  escapeHtml: (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;'),
  _renderMobileMarkdown: (value) => `<p>${String(value)}</p>`,
};
vm.runInNewContext([
  functionSource('_mobileRunPresentationTitle', '_mobileRunArtifactPresentation'),
  functionSource('_mobileRunArtifactPresentation', '_mobileRunSummaryPresentation'),
  functionSource('_mobileRunSummaryPresentation', '_renderSubagentRunsTab'),
].join('\n'), presentationContext);
const longPath = `workspace/${'nested/'.repeat(70)}artifact.vpk`;
const sha256 = 'a'.repeat(64);
const rendered = presentationContext._mobileRunSummaryPresentation(
  `Validation complete.\n\n**Ready artifact** - \`${longPath}\` - Size: **833,830 bytes** - SHA-256: \`${sha256}\``,
  { compact: true },
);
assert(rendered.includes('pm-sa-run-artifact'), 'long artifact output must use the artifact presentation');
assert(rendered.includes(longPath) && rendered.includes(sha256), 'long paths and hashes must remain accessible for copy');
assert(!rendered.includes('**Ready artifact**'), 'raw artifact Markdown must not be exposed in the card');
assert(presentationContext._mobileRunPresentationTitle('[Subagent] Gaming Engineer') === 'Gaming Engineer', 'internal agent labels must be removed from titles');

console.log('Mobile subagent Runs UI contracts passed.');
