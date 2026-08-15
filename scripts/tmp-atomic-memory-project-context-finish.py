from pathlib import Path

path = Path('src/gateway/memory-index/memory-atoms.regression.ts')
text = path.read_text(encoding='utf-8')
marker = "for (const query of [\n  'hi Prometheus',"
pos = text.find(marker)
if pos < 0:
    raise SystemExit('low-signal routing regression marker missing')
insert = """const directTradingQuery = 'What is the NY open trading guardrail?';
const directTrading = retrieveMemoryAtoms(workspacePath, directTradingQuery);
assert.ok(
  directTrading.selected.some((match) => match.atom.sourceStartLine === 9),
  'baseline direct durable-memory query should recall the trading guardrail',
);
const noisyProjectContext = Array.from({ length: 300 }, (_, index) => `unrelated_project_context_term_${index}`).join(' ');
const tradingWithProjectContext = retrieveMemoryAtoms(workspacePath, directTradingQuery, {
  additionalContext: noisyProjectContext,
});
assert.ok(
  tradingWithProjectContext.selected.some((match) => match.atom.sourceStartLine === 9),
  'large unrelated project context must not dilute a direct user-query memory hit below threshold',
);

"""
path.write_text(text[:pos] + insert + text[pos:], encoding='utf-8')
print('atomic memory project-context finish patch applied')
