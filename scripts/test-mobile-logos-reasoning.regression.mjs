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

const s1 = summary('s1', '**Inspecting the renderer**\nReading source.');
const s2 = summary('s2', '**Checking reasoning slot**\nComparing providers.');
const s3 = summary('s3', '**Writing the fix**\nApplying changes.');

{
  // Interleaved summaries and tool batches must update ONE header, never split.
  const entries = [s1, tool('t1', 'Read'), s2, tool('t2', 'Edit'), s3, tool('t3', 'Check')];
  for (const streaming of [true, false]) {
    const folded = foldMobileReasoningSummaryGroups(groupTrace(entries), { streaming });
    assert.equal(folded.length, 1);
    assert.equal(folded[0].kind, 'tools');
    assert.equal(folded[0].entries.length, 3);
    assert.equal(mobileReasoningSummaryTitle(folded[0].reasoningEntries), 'Writing the fix');
    assert.deepEqual(folded[0].reasoningEntries.map(e => e.id), ['s1', 's2', 's3']);
  }
  const before = foldMobileReasoningSummaryGroups(groupTrace(entries.slice(0, 2)), { streaming: true });
  const after = foldMobileReasoningSummaryGroups(groupTrace(entries), { streaming: true });
  assert.equal(before[0].id, after[0].id, 'header/body keep their disclosure key across batches');
  const trailing = foldMobileReasoningSummaryGroups(groupTrace([tool('t1','Read'), s1, s2]), { streaming: true });
  assert.equal(trailing.length, 1, 'trailing summary updates tool header, not separate live label');
  assert.equal(trailing[0].kind, 'tools');
  assert.equal(mobileReasoningSummaryTitle(trailing[0].reasoningEntries), 'Checking reasoning slot');
  const boundary = foldMobileReasoningSummaryGroups(groupTrace([tool('t1','Read'), s1, preamble('p2','Found it'), s2, tool('t2','Check')]), { streaming:true });
  assert.equal(boundary.filter(g => g.kind === 'tools').length, 2);
  assert.equal(boundary.filter(g => g.kind === 'thought').length, 1);
  assert.equal(mobileReasoningSummaryTitle(boundary[0].reasoningEntries), 'Inspecting the renderer');
  assert.equal(mobileReasoningSummaryTitle(boundary[2].reasoningEntries), 'Checking reasoning slot');
  const pending = foldMobileReasoningSummaryGroups(groupTrace([s1,s2]), {streaming:true});
  assert.equal(pending.length,1);
  assert.equal(pending[0].kind,'reasoning-live');
  assert.equal(pending[0].title,'Checking reasoning slot');
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
