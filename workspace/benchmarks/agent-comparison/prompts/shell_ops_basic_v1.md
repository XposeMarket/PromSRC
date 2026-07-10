# shell_ops_basic_v1

Task:
1. Run a command that prints the Node.js version.
2. Run an intentionally failing command for a nonexistent executable named `definitely_not_a_real_command_hermes_bench`.
3. Classify the failure as command-not-found or equivalent.
4. Run a corrected harmless command that prints exactly `SHELL_RECOVERED`.
5. Save a short report to `benchmarks/agent-comparison/fixtures/shell_ops_basic_v1/report.md` with the Node version and failure classification.

Final answer exactly one line:
`SHELL_OPS_BASIC_V1_PASS: recovered=true`

If blocked, answer exactly one line:
`SHELL_OPS_BASIC_V1_BLOCKED: <specific reason>`.
