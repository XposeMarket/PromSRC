import assert from 'node:assert/strict';
import { formatGrepToolResult, type GrepMatchRecord } from './file-intelligence';

const matches: GrepMatchRecord[] = Array.from({ length: 20 }, (_, index) => ({
  path: 'games/last-ward-vita/ISSUES.md',
  file: 'games/last-ward-vita/ISSUES.md',
  line_number: index + 4,
  line: index + 4,
  column: 3,
  text: `| Open | Tooling issue ${index + 1} | Investigate and verify |`,
  match: 'Tooling',
  char_window: { start_column: 1, end_column: 50, before: '| Open | ', match: 'Tooling', after: ' issue |', text: '| Open | Tooling issue |', truncated_left: false, truncated_right: false },
  suggested_read: { path: 'games/last-ward-vita/ISSUES.md', around_line: index + 4, start_line: index + 1, num_lines: 8 },
  suggested_exact_read: { path: 'games/last-ward-vita/ISSUES.md', line: index + 4, column: 3, char_window: 350 },
}));
const payload = { match_count: 20, returned_count: 20, matches };
const detailed = formatGrepToolResult(payload, 'json');
const compact = formatGrepToolResult(payload);
assert.match(compact, /ISSUES\.md:4:3: \| Open \| Tooling issue 1/);
assert.equal(compact.split('\n').length, 21);
assert.doesNotMatch(compact, /suggested_read|char_window/);
assert.ok(compact.length < detailed.length / 3, `compact=${compact.length} detailed=${detailed.length}`);
assert.match(detailed, /suggested_exact_read/);
console.log('compact grep result regression passed');
