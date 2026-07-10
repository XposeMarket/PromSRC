import json, os, subprocess, sys, time
from pathlib import Path

run_date = sys.argv[1] if len(sys.argv) > 1 else '2026-07-09'
root = Path(__file__).resolve().parents[2]
bench_root = root / 'benchmarks' / 'agent-comparison'
hermes_dir = root / 'oss agents' / 'hermes-agent'
ids = ['file_ops_basic_v1','shell_ops_basic_v1','browser_external_v1','local_web_debug_v1','desktop_basic_v1']
pass_re = {
    'file_ops_basic_v1': 'FILE_OPS_BASIC_V1_PASS',
    'shell_ops_basic_v1': 'SHELL_OPS_BASIC_V1_PASS',
    'browser_external_v1': 'BROWSER_EXTERNAL_V1_PASS',
    'local_web_debug_v1': 'LOCAL_WEB_DEBUG_V1_PASS',
    'desktop_basic_v1': 'DESKTOP_BASIC_V1_PASS',
}
results = []
for bid in ids:
    prompt = (bench_root / 'prompts' / f'{bid}.md').read_text(encoding='utf-8')
    out_dir = bench_root / 'runs' / run_date / 'hermes' / bid
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ['events.jsonl','summary.json','stdout.txt','stderr.txt']:
        try: (out_dir / name).unlink()
        except FileNotFoundError: pass
    env = os.environ.copy()
    env['HERMES_TELEMETRY_PATH'] = str(Path('..') / '..' / 'benchmarks' / 'agent-comparison' / 'runs' / run_date / 'hermes' / bid / 'events.jsonl')
    env['HERMES_BENCHMARK_RUN_ID'] = f'hermes_{run_date}_{bid}'
    env['HERMES_BENCHMARK_ID'] = bid
    cmd = [sys.executable, '-m', 'uv', 'run', 'hermes', 'chat', '--provider', 'openai-codex', '-m', 'gpt-5.5', '-Q', '-q', prompt]
    start = time.perf_counter()
    proc = subprocess.run(cmd, cwd=str(hermes_dir), env=env, text=True, encoding='utf-8', errors='replace', capture_output=True)
    wall_ms = int((time.perf_counter() - start) * 1000)
    stdout = proc.stdout or ''
    stderr = proc.stderr or ''
    (out_dir / 'stdout.txt').write_text(stdout, encoding='utf-8')
    (out_dir / 'stderr.txt').write_text(stderr, encoding='utf-8')
    text = (stdout + stderr).strip()
    status = 'pass' if proc.returncode == 0 and pass_re[bid] in text else ('blocked' if 'BLOCKED' in text else 'fail')
    events_path = out_dir / 'events.jsonl'
    model_calls = model_ms = tool_calls = tool_ms = tool_errors = tokens_in = tokens_out = 0
    if events_path.exists():
        for line in events_path.read_text(encoding='utf-8', errors='replace').splitlines():
            if not line.strip(): continue
            try: e = json.loads(line)
            except Exception: continue
            if e.get('type') == 'tool_call_end':
                tool_calls += 1
                tool_ms += int(e.get('latency_ms') or 0)
                if e.get('status') != 'ok': tool_errors += 1
            elif e.get('type') == 'model_call_end':
                model_calls += 1
                model_ms += int(e.get('latency_ms') or 0)
                tokens_in += int(e.get('input_tokens') or 0)
                tokens_out += int(e.get('output_tokens') or 0)
    summary = {
        'run_id': f'hermes_{run_date}_{bid}', 'agent': 'hermes', 'benchmark_id': bid,
        'measurement_mode': 'black_box_cli_with_internal_telemetry', 'status': status,
        'blocked_reason': None, 'total_wall_ms': wall_ms, 'exit_code': proc.returncode,
        'model_calls': model_calls, 'model_latency_ms': model_ms,
        'tool_calls': tool_calls, 'tool_latency_ms': tool_ms, 'tool_errors': tool_errors,
        'retries': None, 'tokens_input': tokens_in or None, 'tokens_output': tokens_out or None,
        'estimated_cost_usd': None,
        'artifacts': [f'benchmarks/agent-comparison/runs/{run_date}/hermes/{bid}/stdout.txt', f'benchmarks/agent-comparison/runs/{run_date}/hermes/{bid}/stderr.txt', f'benchmarks/agent-comparison/runs/{run_date}/hermes/{bid}/events.jsonl'],
        'final_output': text[-4000:],
        'notes': 'Hermes run via Python/PowerShell wrapper; internal telemetry enabled by HERMES_TELEMETRY_PATH.'
    }
    (out_dir / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    results.append({k: summary[k] for k in ['benchmark_id','status','total_wall_ms','exit_code','model_calls','model_latency_ms','tool_calls','tool_latency_ms','tool_errors','tokens_input','tokens_output']})
print(json.dumps(results, indent=2))
