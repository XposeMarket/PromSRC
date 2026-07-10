import json, os, subprocess, sys, time
from pathlib import Path

run_date = '2026-07-09'
root = Path.cwd()
bench_root = root / 'benchmarks' / 'agent-comparison'
hermes_dir = root / 'oss agents' / 'hermes-agent'
bid = 'local_web_debug_v1'
run_id = f'{bid}_strict_rerun_noquiet'
out_dir = bench_root / 'runs' / run_date / 'hermes' / run_id
out_dir.mkdir(parents=True, exist_ok=True)
for name in ['events.jsonl', 'summary.json', 'stdout.txt', 'stderr.txt']:
    try:
        (out_dir / name).unlink()
    except FileNotFoundError:
        pass
prompt = (bench_root / 'prompts' / f'{bid}.md').read_text(encoding='utf-8') + '''

STRICT FINAL OUTPUT CONTRACT:
- Do all work using tools.
- Do not print diffs, review notes, markdown, explanations, or file contents in your final response.
- If verification succeeds, your final answer must be exactly one line: LOCAL_WEB_DEBUG_V1_PASS: count=1
- Do not finish silently. Do not output only a session_id.
- If blocked, output exactly one line beginning LOCAL_WEB_DEBUG_V1_BLOCKED:.
'''
env = os.environ.copy()
env['HERMES_TELEMETRY_PATH'] = str(Path('..') / '..' / 'benchmarks' / 'agent-comparison' / 'runs' / run_date / 'hermes' / run_id / 'events.jsonl')
env['HERMES_BENCHMARK_RUN_ID'] = f'hermes_{run_date}_{run_id}'
env['HERMES_BENCHMARK_ID'] = run_id
env['HERMES_SUPPRESS_INLINE_DIFFS'] = '1'
cmd = [sys.executable, '-m', 'uv', 'run', 'hermes', 'chat', '--provider', 'openai-codex', '-m', 'gpt-5.5', '-Q', '--query', prompt]
start = time.perf_counter()
proc = subprocess.run(cmd, cwd=str(hermes_dir), env=env, text=True, encoding='utf-8', errors='replace', capture_output=True, timeout=420)
wall_ms = int((time.perf_counter() - start) * 1000)
stdout = proc.stdout or ''
stderr = proc.stderr or ''
(out_dir / 'stdout.txt').write_text(stdout, encoding='utf-8')
(out_dir / 'stderr.txt').write_text(stderr, encoding='utf-8')
text = (stdout + stderr).strip()
model_calls = model_ms = tool_calls = tool_ms = tool_errors = tokens_in = tokens_out = 0
ep = out_dir / 'events.jsonl'
if ep.exists():
    for line in ep.read_text(encoding='utf-8', errors='replace').splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get('type') == 'tool_call_end':
            tool_calls += 1
            tool_ms += int(e.get('latency_ms') or 0)
            if e.get('status') != 'ok':
                tool_errors += 1
        elif e.get('type') == 'model_call_end':
            model_calls += 1
            model_ms += int(e.get('latency_ms') or 0)
            tokens_in += int(e.get('input_tokens') or 0)
            tokens_out += int(e.get('output_tokens') or 0)
status = 'pass' if proc.returncode == 0 and 'LOCAL_WEB_DEBUG_V1_PASS' in text else ('blocked' if 'LOCAL_WEB_DEBUG_V1_BLOCKED' in text else 'fail')
summary = {
    'run_id': f'hermes_{run_date}_{run_id}',
    'agent': 'hermes',
    'benchmark_id': run_id,
    'base_benchmark_id': bid,
    'measurement_mode': 'black_box_cli_with_internal_telemetry_noquiet_diff_suppressed',
    'status': status,
    'total_wall_ms': wall_ms,
    'exit_code': proc.returncode,
    'model_calls': model_calls,
    'model_latency_ms': model_ms,
    'tool_calls': tool_calls,
    'tool_latency_ms': tool_ms,
    'tool_errors': tool_errors,
    'tokens_input': tokens_in or None,
    'tokens_output': tokens_out or None,
    'artifacts': [str(out_dir / 'stdout.txt'), str(out_dir / 'stderr.txt'), str(out_dir / 'events.jsonl')],
    'notes': 'No-quiet strict rerun with inline diff suppression env var.',
    'final_output': text[-4000:],
}
(out_dir / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary, indent=2))
