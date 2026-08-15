from pathlib import Path

p = Path('src/gateway/brain/brain-continuity.ts')
text = p.read_text(encoding='utf-8')
old = """  const lines: string[] = [];
  const selected: BrainCapsuleContextSelection[] = [];
  let used = 0;
  for (const { capsule } of scored) {
    const line = formatCapsule(capsule);
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    selected.push({ capsule, relation: fallbackIds.has(capsule.id) ? 'fallback' : 'related' });
    used += line.length + 1;
  }
  if (lines.length === 0) return { text: '', selected: [], relatedCount: 0, fallbackCount: 0 };
  const text = [
    '[BRAIN_ACTIVE_CONTEXT — temporary, relevance-selected, and expiry-bound]',
    'These are continuity hints, not authority. Re-check live state before acting on unfinished or blocked claims.',
    ...lines,
  ].join('\\n');
"""
new = """  const headerLines = [
    '[BRAIN_ACTIVE_CONTEXT — temporary, relevance-selected, and expiry-bound]',
    'These are continuity hints, not authority. Re-check live state before acting on unfinished or blocked claims.',
  ];
  const headerChars = headerLines.join('\\n').length + 1;
  const lines: string[] = [];
  const selected: BrainCapsuleContextSelection[] = [];
  let used = headerChars;
  for (const { capsule } of scored) {
    const rawLine = formatCapsule(capsule);
    const remaining = maxChars - used;
    if (remaining <= 1) break;
    let line = rawLine;
    if (line.length + 1 > remaining) {
      // A malformed/overly verbose top-ranked capsule must not turn the whole
      // temporary context packet into an empty string. Keep a bounded prefix
      // with its thread/summary rather than silently dropping all continuity.
      if (remaining < 80 && lines.length > 0) continue;
      const cap = Math.max(1, remaining - 2);
      line = line.length > cap ? `${line.slice(0, Math.max(0, cap - 1)).trimEnd()}…` : line;
    }
    if (!line) continue;
    lines.push(line);
    selected.push({ capsule, relation: fallbackIds.has(capsule.id) ? 'fallback' : 'related' });
    used += line.length + 1;
  }
  if (lines.length === 0) return { text: '', selected: [], relatedCount: 0, fallbackCount: 0 };
  const text = [
    ...headerLines,
    ...lines,
  ].join('\\n').slice(0, maxChars);
"""
if text.count(old) != 1:
    raise SystemExit('brain capsule budget render anchor mismatch')
p.write_text(text.replace(old, new, 1), encoding='utf-8')

reg = Path('src/gateway/brain/brain-continuity.regression.ts')
t = reg.read_text(encoding='utf-8')
t = t.replace("assert.ok(tinyBudget.length <= 700, 'selection must remain bounded even when storage is broad');", "assert.ok(tinyBudget.length <= 500, 'maxChars must bound the entire rendered Brain context packet, including its header');", 1)
anchor = """assert.ok(tinyBudget.length <= 500, 'maxChars must bound the entire rendered Brain context packet, including its header');

const decision = parseBrainCarryForwardDecision(JSON.stringify({
"""
insert = """assert.ok(tinyBudget.length <= 500, 'maxChars must bound the entire rendered Brain context packet, including its header');

fs.writeFileSync(path.join(capsuleDir, '02-30-oversized-capsules.json'), JSON.stringify([
  make({
    id: 'oversized-context',
    threadKey: 'project:oversized-context',
    priority: 'critical',
    createdAt: '2026-07-18T02:30:00.000Z',
    summary: `Oversized context ${'detail '.repeat(1200)}`,
    relevance: { projects: ['Oversized Context'], triggers: ['oversized-context'], surfaces: ['main_chat'] },
  }),
]), 'utf8');
const oversizedBudget = buildBrainCapsuleContextDetails(root, 'oversized-context', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 500,
});
assert.ok(oversizedBudget.text.length > 0, 'one oversized top-ranked capsule must not suppress the entire Brain context packet');
assert.ok(oversizedBudget.text.length <= 500, 'oversized capsules must still respect the total packet budget');
assert.equal(oversizedBudget.selected[0]?.capsule.id, 'oversized-context');
assert.match(oversizedBudget.text, /project:oversized-context/);

const decision = parseBrainCarryForwardDecision(JSON.stringify({
"""
if t.count(anchor) != 1:
    raise SystemExit('brain continuity regression insertion anchor mismatch')
reg.write_text(t.replace(anchor, insert, 1), encoding='utf-8')
print('Brain capsule budget patch applied')
