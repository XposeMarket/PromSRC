from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# additionalContext is supporting/disambiguation context. It must never enlarge
# the lexical query denominator, otherwise a large project packet makes a direct
# user-memory question score *worse* as more project context is supplied.
replace_once(
    'src/gateway/memory-index/memory-atoms.ts',
    "  const queryTerms = tokenize(`${queryText} ${additionalContext}`);\n",
    "  // Score lexical relevance against the user's query only. Project/other\n  // additional context is positive-only supporting context inside scoreAtom\n  // (entity/section disambiguation); it must not dilute a direct memory match.\n  const queryTerms = tokenize(queryText);\n",
)

# Regression: an arbitrarily large unrelated project packet cannot suppress a
# durable atom that is otherwise a strong direct answer to the user's turn.
test = Path('src/gateway/memory-index/memory-atoms.regression.ts').read_text(encoding='utf-8')
anchor = """assert.deepEqual(failures, [], `corpus queries missed expected atoms:\n${failures.join('\\n')}`);

for (const query of [
"""
insert = """assert.deepEqual(failures, [], `corpus queries missed expected atoms:\n${failures.join('\\n')}`);

const directTradingQuery = 'What is the NY open trading guardrail?';
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

for (const query of [
"""
if test.count(anchor) != 1:
    raise SystemExit('memory atom regression insertion anchor mismatch')
test = test.replace(anchor, insert, 1)
Path('src/gateway/memory-index/memory-atoms.regression.ts').write_text(test, encoding='utf-8')

print('atomic memory project-context patch applied')
