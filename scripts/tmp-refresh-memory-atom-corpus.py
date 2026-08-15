from pathlib import Path
p = Path('src/gateway/memory-index/memory-atoms.regression.ts')
text = p.read_text(encoding='utf-8')
text = text.replace("assert.equal(atoms.length, 60, 'the current MEMORY.md corpus should parse into 60 bullet atoms');", "assert.equal(atoms.length, 61, 'the current MEMORY.md corpus should parse into 61 bullet atoms');", 1)
anchor = "  { query: 'What is the NebulaX milestone lifecycle?', expectedLine: 91 },\n"
if text.count(anchor) != 1:
    raise SystemExit('corpus tail anchor mismatch')
text = text.replace(anchor, anchor + "  { query: 'What replaced the special Prometheus self-edit workflow?', expectedLine: 92 },\n", 1)
p.write_text(text, encoding='utf-8')
print('refreshed memory atom corpus regression')
