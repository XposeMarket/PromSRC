// Regression (Raul, 2026-11-05, mobile app):
// A) drawer provider logos showed on first paint and vanished after every
//    paged drawer refresh, because _normalizeSessionSummary dropped lastModel.
// G) OpenAI reasoning summaries rendered as reply-like paragraphs between
//    tool groups (one per phase) instead of overwriting one live label in the
//    tool stream. Anthropic/Prom narration must stay unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  foldMobileReasoningSummaryGroups,
  isMobileReasoningSummaryEntry,
  mobileReasoningSummaryTitle,
  renderMobileReasoningLiveGroup,
  MOBILE_REASONING_LIVE_GROUP_ID,
} from '../web-ui/src/mobile/mobile-reasoning-summary-fold.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const apiSource = read('web-ui/src/mobile/mobile-api.js');
const shellSource = read('web-ui/src/mobile/mobile-shell.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const foldSource = read('web-ui/src/mobile/mobile-reasoning-summary-fold.js');

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `could not locate ${startMarker}`);
  return source.slice(start, end);
}

// ---------- A. provider logos survive the normalizer ----------
const normalize = new Function(
  `${slice(apiSource, 'function _normalizeSessionSummary(', 'export async function createMobileChatSession(')}return _normalizeSessionSummary;`,
)();
const brands = {
  claude: { label: 'Claude', asset: '/claude.svg', key: 'claude' },
  openai: { label: 'OpenAI', asset: '/openai.svg', key: 'openai' },
  chatgpt: { label: 'ChatGPT', asset: '/chatgpt.svg', key: 'chatgpt' },
};
const logoFor = new Function('MOBILE_IMPORTED_SOURCE_BRANDS',
  `${slice(shellSource, 'function _mobileSessionModelLogo(', 'function _projectButtonHtml(')}return _mobileSessionModelLogo;`,
)(brands);

{
  // Slim drawer row: route without override/providerId, answered by Astra.
  const raw = {
    id: 'mobile_a', title: 'Chat', chatModelRoute: { effective: { providerId: 'openai_codex' } },
    lastModel: { providerId: 'openai_codex', model: 'gpt-6-astra', extra: 'dropped' },
  };
  const row = normalize(raw);
  assert.deepEqual(row.lastModel, { providerId: 'openai_codex', model: 'gpt-6-astra' },
    'normalized drawer rows must keep lastModel (the logo source)');
  assert.match(logoFor(row), /pm-session-model-logo--openai/, 'logo must render after a normalized refresh');
  assert.equal(logoFor(raw).includes('pm-session-model-logo--openai'), logoFor(row).includes('pm-session-model-logo--openai'),
    'first paint (raw) and refreshed (normalized) rows must show the same logo');

  const claude = normalize({ id: 'mobile_b', lastModel: { providerId: 'anthropic', model: 'claude-opus-5-5' } });
  assert.match(logoFor(claude), /pm-session-model-logo--claude/);

  // An explicit per-chat route still wins over lastModel.
  const routed = normalize({
    id: 'mobile_c',
    chatModelRoute: { override: { providerId: 'anthropic', model: 'claude-haiku-5-5' } },
    lastModel: { providerId: 'openai_codex', model: 'gpt-6-astra' },
  });
  assert.match(logoFor(routed), /pm-session-model-logo--claude/, 'explicit chat route must keep priority');

  // Must not: garbage never becomes a lastModel.
  assert.equal(normalize({ id: 'x', lastModel: 'openai' }).lastModel, null);
  assert.equal(normalize({ id: 'x', lastModel: { model: 'gpt-6-astra' } }).lastModel, null);
  assert.equal(normalize({ id: 'x' }).lastModel, null);
  assert.equal(logoFor(normalize({ id: 'x' })), '', 'no model means no logo, never the global default');
}
console.log('A: drawer provider logos survive normalized refreshes');

// A2. The paired-device gateway catalog (/api/mobile/gateway/catalog) is the drawer's primary
// source (namespaced gw_...::id rows, spread raw by mobile-gateway-catalog.js). Its cross-origin
// projection must carry the compact lastModel too, and nothing else model-related.
{
  const pairing = read('src/gateway/routes/pairing.router.ts');
  const body = slice(pairing, 'function _safeCatalogSession(', 'function _safeCatalogAgent(')
    .replace('(session: any): Record<string, unknown>', '(session)');
  const safe = new Function(`${body}return _safeCatalogSession;`)();
  const row = safe({
    id: 's1', title: 'T',
    lastModel: { providerId: 'anthropic', model: 'claude-opus-5-5', apiKey: 'never' },
    chatModelRoute: { override: { providerId: 'openai_codex', model: 'gpt-6-astra' } },
    workspacePath: 'C:/secret',
  });
  assert.deepEqual(row.lastModel, { providerId: 'anthropic', model: 'claude-opus-5-5' }, 'catalog keeps compact lastModel');
  assert.equal('chatModelRoute' in row, false, 'catalog never exposes model routes');
  assert.equal('workspacePath' in row, false, 'catalog never exposes paths');
  assert.match(logoFor(row), /pm-session-model-logo--claude/, 'catalog-backed drawer row renders the provider logo');
  assert.equal('lastModel' in safe({ id: 's2', lastModel: { model: 'gpt-6-astra' } }), false, 'no providerId means no lastModel');
  assert.equal('lastModel' in safe({ id: 's3', lastModel: 'openai' }), false, 'garbage lastModel is dropped');
  assert.equal(safe({ id: 's4', lastModel: { providerId: 'x'.repeat(200), model: 'm'.repeat(300) } }).lastModel.model.length, 120, 'bounded');
}
console.log('A2: gateway catalog rows keep the provider logo source');

// ---------- G. reasoning summaries fold into one live label ----------
// Use the REAL renderer grouping so the fold is tested against actual groups.
const groupTrace = new Function(
  '_mobileVisibleTraceEntries', '_isMobileTraceCompactionEntry', '_renderMobileLiveTracePreview',
  '_isMobileTraceThoughtEntry', '_mobileTraceThoughtKind', '_mobileTraceGroupStableKey',
  `${slice(renderer, 'function _mobileTraceGroups(', 'function _mobileTraceHasToolGroup(')}return _mobileTraceGroups;`,
)(
  (entries) => entries,
  () => false,
  () => '',
  (entry) => ['think', 'preamble', 'assistant', 'reasoning_summary'].includes(entry.type),
  (entry) => (entry.type === 'preamble' || entry.extra?.reasoningKind === 'full_thought' ? 'full_thought' : 'summary'),
  (group, index) => `trace_group_${group.kind}_${group.entries[0]?.id || index}`,
);

const summary = (id, text) => ({ id, type: 'think', text, extra: { source: 'reasoning_summary', visibility: 'summary', reasoningKind: 'summary' } });
const progress = (id, text) => ({ id, type: 'think', text, extra: { source: 'agent_progress', visibility: 'summary', reasoningKind: 'summary' } });
const preamble = (id, text) => ({ id, type: 'preamble', text, extra: { source: 'agent_thought', visibility: 'user', reasoningKind: 'full_thought' } });
const tool = (id, label) => ({ id, type: 'tool', text: label, activity: { kind: 'operation', callId: id } });

const s1 = summary('s1', '**Inspecting the renderer**\n\nReading the mobile trace grouping code.');
const s2 = summary('s2', '**Checking reasoning slot**\n\nComparing with the Anthropic path.');
const s3 = summary('s3', '**Writing the fix**\n\nApplying the fold.');
const reasoningGroups = (groups) => groups.filter((group) => group.kind === 'thought-summary'
  && group.entries.some(isMobileReasoningSummaryEntry));

{
  // Live: summary -> tool -> latest summary.
  const folded = foldMobileReasoningSummaryGroups(groupTrace([s1, tool('t1', 'Read file'), s2]), { streaming: true });
  assert.equal(reasoningGroups(folded).length, 0, 'no reasoning prose may remain as a standalone timeline paragraph');
  const live = folded.filter((group) => group.kind === 'reasoning-live');
  assert.equal(live.length, 1, 'exactly one live reasoning label');
  assert.equal(live[0].title, 'Checking reasoning slot', 'the live label shows the LATEST summary title');
  assert.equal(live[0].id, MOBILE_REASONING_LIVE_GROUP_ID);
  const tools = folded.filter((group) => group.kind === 'tools');
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].reasoningEntries.map((entry) => entry.id), ['s1'],
    'the earlier summary moves inside its tool phase body');

  // Overwrite: the next summary replaces the label in the same keyed slot.
  const next = foldMobileReasoningSummaryGroups(groupTrace([s1, tool('t1', 'Read file'), s2, s3]), { streaming: true });
  const nextLive = next.filter((group) => group.kind === 'reasoning-live');
  assert.equal(nextLive.length, 1);
  assert.equal(nextLive[0].id, live[0].id, 'same keyed group id, so the label is overwritten in place');
  assert.equal(nextLive[0].title, 'Writing the fix');
  assert.equal(next.length, folded.length, 'a newer summary must not add a timeline row');
}

{
  // Live: summary then a running tool. The tool header owns the summary title.
  const folded = foldMobileReasoningSummaryGroups(groupTrace([s1, tool('t1', 'Read file'), s2, tool('t2', 'Edit file')]), { streaming: true });
  assert.equal(folded.some((group) => group.kind === 'reasoning-live'), false);
  const last = folded[folded.length - 1];
  assert.equal(last.kind, 'tools');
  assert.equal(mobileReasoningSummaryTitle(last.reasoningEntries), 'Checking reasoning slot',
    'the running tool group header shows the summary that narrates it');
}

{
  // Completed with tools: every summary sits in a collapsible tool body.
  const folded = foldMobileReasoningSummaryGroups(groupTrace([
    s1, tool('t1', 'Read file'), s2, tool('t2', 'Edit file'), s3,
  ]), { streaming: false });
  assert.equal(reasoningGroups(folded).length, 0);
  assert.equal(folded.some((group) => group.kind === 'reasoning-live'), false, 'no live label after the turn ends');
  const tools = folded.filter((group) => group.kind === 'tools');
  assert.deepEqual(tools.map((group) => (group.reasoningEntries || []).map((entry) => entry.id)), [['s1'], ['s2', 's3']],
    'trailing summaries stay with the latest tool phase');
}

{
  // Must not: Prom narration, preambles and full thoughts render exactly as before.
  const entries = [progress('p1', 'Locating the stream reader'), preamble('pre', 'Here is the plan.'), tool('t1', 'Read file')];
  const groups = groupTrace(entries);
  assert.deepEqual(foldMobileReasoningSummaryGroups(groups, { streaming: true }), groups,
    'non-OpenAI traces (Anthropic/Prom narration) are untouched');
  const fullThought = { ...s1, extra: { ...s1.extra, reasoningKind: 'full_thought' } };
  assert.equal(isMobileReasoningSummaryEntry(fullThought), false, 'full thoughts are never folded');

  // Mixed: narration keeps its group, only reasoning entries fold.
  const mixed = foldMobileReasoningSummaryGroups(groupTrace([progress('p1', 'Locating'), s1, tool('t1', 'Read file')]), { streaming: true });
  assert.ok(mixed.some((group) => group.kind === 'thought-summary' && group.entries.some((entry) => entry.id === 'p1')),
    'agent_progress narration stays visible');
  assert.deepEqual(mixed.find((group) => group.kind === 'tools').reasoningEntries.map((entry) => entry.id), ['s1']);

  // Must not lose reasoning in a completed reasoning-only turn.
  const reasoningOnly = groupTrace([s1]);
  assert.deepEqual(foldMobileReasoningSummaryGroups(reasoningOnly, { streaming: false }), reasoningOnly,
    'completed reasoning-only turns keep their prose inside the collapsed drawer');
}

{
  assert.equal(mobileReasoningSummaryTitle([s1]), 'Inspecting the renderer');
  assert.equal(mobileReasoningSummaryTitle([summary('plain', 'No heading here, just text')]), 'No heading here, just text');
  assert.equal(mobileReasoningSummaryTitle([]), '');
  const html = renderMobileReasoningLiveGroup({ id: MOBILE_REASONING_LIVE_GROUP_ID, entries: [summary('x', '<b>Probe</b> & "check"')] });
  assert.match(html, /data-pm-trace-live-current="1"/);
  assert.match(html, /class="pm-trace-thought-summary"/, 'reuses the existing live label slot styling');
  assert.doesNotMatch(html, /<b>Probe/, 'summary titles are escaped');
  assert.equal(renderMobileReasoningLiveGroup({ entries: [] }), '');
  assert.match(renderMobileReasoningLiveGroup({ entries: [s2] }, { renderLabel: (t) => `[${t}]` }), /\[Checking reasoning slot\]/);
}
console.log('G: OpenAI reasoning summaries overwrite one live label');

// ---------- wiring contracts (renderer runs inside a DOM factory) ----------
assert.match(renderer, /import \{ foldMobileReasoningSummaryGroups, mobileReasoningSummaryTitle, renderMobileReasoningLiveGroup \} from '\.\/mobile-reasoning-summary-fold\.js';/);
assert.match(renderer, /if \(!kindFilter\) groups = foldMobileReasoningSummaryGroups\(groups, \{ streaming \}\);/);
assert.match(renderer, /group\.kind === 'reasoning-live'\) return renderMobileReasoningLiveGroup\(group, \{ renderLabel: renderThinkingState \}\)/);
assert.match(renderer, /mobileReasoningSummaryTitle\(group\.reasoningEntries\)/);
assert.match(renderer, /_renderMobileLiveTrace\(bodyTraceEntries\)/, 'folded summaries render inside the collapsible tool body');
assert.match(renderer, /\$\{bodyTraceEntries\.map\(_renderMobileLiveTraceEntry\)\.join\(''\)\}/, 'expanded (agent sheet) tool bodies keep folded summaries');
assert.doesNotMatch(foldSource, /<details/, 'no nested disclosure (Raul, 2026-10-28)');
assert.doesNotMatch(foldSource, /^import /m, 'fold module stays pure for Node regressions');

// The shipped bundle must contain the fold (sync:web-ui ran).
const buildDir = 'generated/public-web-ui/build';
if (fs.existsSync(buildDir)) {
  const stack = [buildDir];
  let found = false;
  while (stack.length && !found) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (name.endsWith('.js') && read(full).includes('trace_group_reasoning_live')) { found = true; break; }
    }
  }
  assert.ok(found, 'generated web-ui bundle is stale: run npm run sync:web-ui');
}
console.log('mobile logos + reasoning regression passed');
