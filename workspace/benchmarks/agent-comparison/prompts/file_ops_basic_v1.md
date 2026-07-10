# file_ops_basic_v1

Workspace-relative root: `benchmarks/agent-comparison/fixtures/file_ops_basic_v1`.

Task:
1. Create the fixture directory if missing.
2. Create `input.txt` containing exactly:
   `alpha\nbravo\ncharlie\n`
3. Read it back.
4. Search for `bravo`.
5. Create `report.md` with:
   - heading `# file_ops_basic_v1 report`
   - line `found_bravo: true`
   - line `line_count: 3`
6. Verify `report.md` exists and contains both `found_bravo: true` and `line_count: 3`.

Final answer exactly one line:
`FILE_OPS_BASIC_V1_PASS: found_bravo=true line_count=3`

If blocked, answer exactly one line:
`FILE_OPS_BASIC_V1_BLOCKED: <specific reason>`.
