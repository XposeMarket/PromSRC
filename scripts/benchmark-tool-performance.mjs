import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const baseUrl = new URL(process.env.PROMETHEUS_BENCHMARK_URL || 'http://127.0.0.1:18789/');
const root = path.resolve('.');
const dataRoot = process.env.PROMETHEUS_DATA_DIR || root;
const timingPath = path.join(dataRoot, '.prometheus', 'logs', 'turn-timing.log');
const usagePath = path.join(dataRoot, '.prometheus', 'model-usage.jsonl');
const requestedFamilies = String(process.env.PROMETHEUS_TOOL_BENCH_FAMILIES || 'desktop,browser,workspace,terminal,web_search_fetch,mcp_connector,subagent_task,core')
  .split(',').map((value) => value.trim()).filter(Boolean);
const samplesPerFamily = Math.max(1, Math.min(3, Number(process.env.PROMETHEUS_TOOL_BENCH_SAMPLES || 1)));
const model = 'gpt-5.6-luna';
const providerId = 'openai_codex';
const reasoningEffort = String(process.env.PROMETHEUS_TOOL_BENCH_REASONING || 'low').toLowerCase() === 'medium' ? 'medium' : 'low';
const timeoutMs = Math.max(30_000, Math.min(8 * 60_000, Number(process.env.PROMETHEUS_TOOL_BENCH_TIMEOUT_MS || 240_000)));
const desktopDeep = String(process.env.PROMETHEUS_TOOL_BENCH_DESKTOP_DEEP || 'false').trim().toLowerCase() === 'true';
const explicitCategoryRequests = String(process.env.PROMETHEUS_TOOL_BENCH_EXPLICIT_CATEGORY_REQUESTS || 'true').trim().toLowerCase() !== 'false';
const memoryMode = String(process.env.PROMETHEUS_TOOL_BENCH_MEMORY_MODE || 'full').trim().toLowerCase() === 'compact' ? 'compact' : 'full';

const categoryRequest = (category) => explicitCategoryRequests
  ? `First use request_tool_category exactly once with category="${category}" and scope="turn". Then `
  : '';

const prompts = {
  desktop: `Use desktop_screen exactly once with action="doctor" and deep=${desktopDeep ? 'true' : 'false'}. This is a read-only local health check. ${desktopDeep ? 'Use the deep probe only because this benchmark explicitly measures its stages.' : 'Use the fast probe and do not enable the deep probe.'} Do not take a screenshot, click, type, focus, open, close, or change anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After that one tool call, reply with one short summary and finish.`,
  browser: 'Use browser_session exactly once with action="open", target="prometheus", and url="http://127.0.0.1:18789/". Then use browser_observe exactly once to inspect the current page. This is read-only: do not click, type, submit, sign in, or mutate anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After the required browser calls, reply with one short summary and finish.',
  workspace: 'Use workspace_read exactly once with action="read" on the single existing file workspace/self/02-startup-runtime.md, capped to 3 lines. This is read-only: do not write, edit, delete, or create anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After that one tool call, reply with one short summary and finish.',
  terminal: `${categoryRequest('workspace_write')}use workspace_run exactly once with action="run" to execute the read-only command node --version in the current project root. Do not start a process, write files, install packages, or change anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After the required tool call, reply with one short summary and finish.`,
  web_search_fetch: 'Use web_fetch exactly once for https://example.com. Read-only public fetch only; do not log in, post, submit, or follow any links. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After that one tool call, reply with one short summary and finish.',
  mcp_connector: 'Use connector_list exactly once to inspect local connector status. This is read-only discovery: do not connect, authenticate, send, or mutate anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After that one tool call, reply with one short summary and finish.',
  subagent_task: `${categoryRequest('agents_and_teams')}use agent_ops exactly once with action="list" to inspect the existing local agent/task registry. This is read-only: do not create, spawn, delegate, update, delete, dispatch, or deploy anything. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After the required tool call, reply with one short summary and finish.`,
  core: 'Use the timer tool exactly once with action="list" to report the current local timer registry. This is read-only and must not activate or use any other tool. Do not ask me any question, call ask_prometheus_questions, wait for approval, or use another tool. After that one tool call, reply with one short summary and finish.',
  prometheus_admin: `${categoryRequest('runtime_admin')}use system_diagnostics exactly once with limit=5 and depth="summary". This is a read-only local Prometheus health snapshot. Do not restart anything, change settings, ask a question, or use another tool. After the required tool call, reply briefly and finish.`,
  task_control: `${categoryRequest('automation_tasks')}use task_control exactly once with action="list", limit=10, and include_all_sessions=true. This is read-only task discovery. Do not resume, pause, cancel, delete, steer, create, or use another tool. After the required tool call, reply briefly and finish.`,
  agent_runs: `${categoryRequest('agents_and_teams')}use agent_run_ops exactly once with action="list", limit=10, and detail="compact". This is read-only inspection of existing subagent runs. Do not steer, recover, resume, rerun, pause, cancel, benchmark, or use another tool. After the required tool call, reply briefly and finish.`,
  thread_ops: `${categoryRequest('automation_sessions')}use prometheus_thread_ops exactly once with action="list", limit=10, state="active", and include_automated=false. This is read-only inspection of Prometheus chat threads. Do not create, send, steer, interrupt, reopen, or use another tool. After the required tool call, reply briefly and finish.`,
  audit_ops: `${categoryRequest('automation_recovery')}use prometheus_audit_ops exactly once with action="recent_sessions" and limit=10. This is read-only bounded interruption evidence. Do not recover, mutate, or use another tool. After the required tool call, reply briefly and finish.`,
  request_ops: `${categoryRequest('automation_recovery')}use prometheus_request_ops exactly once with action="list" and limit=10. This is read-only inspection of durable requests. Do not approve, apply, recover, or use another tool. After the required tool call, reply briefly and finish.`,
  scheduling: `${categoryRequest('automation_scheduling')}use schedule_job exactly once with action="list" and limit=10. This is read-only schedule discovery. Do not create, update, pause, resume, delete, run, or use another tool. After the required tool call, reply briefly and finish.`,
  memory: `${categoryRequest('advanced_memory')}use memory_provider_status exactly once. This is read-only local memory backend status. Do not refresh, backfill, write, consolidate, or use another tool. After the required tool call, reply briefly and finish.`,
  skills: `${categoryRequest('skills')}use skill_list exactly once with limit=10 and include_descriptions=false. This is read-only skill discovery. Do not create, import, export, update, audit, or use another tool. After the required tool call, reply briefly and finish.`,
  models: `${categoryRequest('model_management')}use get_agent_models exactly once. This is read-only model routing inspection. Do not switch or update any model and do not use another tool. After the required tool call, reply briefly and finish.`,
  integrations: `${categoryRequest('external_apps')}use connection_ops exactly once with action="list". This is read-only local connector discovery. Do not connect, authenticate, repair, disconnect, or use another tool. After the required tool call, reply briefly and finish.`,
  business: `${categoryRequest('business')}use list_entities exactly once. This is read-only local business-entity discovery. Do not write, update, append, or use another tool. After the required tool call, reply briefly and finish.`,
};

const toolFilters = {
  desktop: ['desktop_screen'],
  browser: ['browser_session', 'browser_observe'],
  workspace: ['workspace_read'],
  terminal: ['request_tool_category', 'workspace_run'],
  web_search_fetch: ['web_fetch'],
  mcp_connector: ['connector_list'],
  subagent_task: ['request_tool_category', 'agent_ops'],
  core: ['timer'],
  prometheus_admin: ['request_tool_category', 'system_diagnostics'],
  task_control: ['request_tool_category', 'task_control'],
  agent_runs: ['request_tool_category', 'agent_run_ops'],
  thread_ops: ['request_tool_category', 'prometheus_thread_ops'],
  audit_ops: ['request_tool_category', 'prometheus_audit_ops'],
  request_ops: ['request_tool_category', 'prometheus_request_ops'],
  scheduling: ['request_tool_category', 'schedule_job'],
  memory: ['request_tool_category', 'memory_provider_status'],
  skills: ['request_tool_category', 'skill_list'],
  models: ['request_tool_category', 'get_agent_models'],
  integrations: ['request_tool_category', 'connection_ops'],
  business: ['request_tool_category', 'list_entities'],
};

const expectedTools = {
  desktop: ['desktop_screen'],
  browser: ['browser_session', 'browser_observe'],
  workspace: ['workspace_read'],
  terminal: ['workspace_run'],
  web_search_fetch: ['web_fetch'],
  mcp_connector: ['connector_list'],
  subagent_task: ['agent_ops'],
  core: ['timer'],
  prometheus_admin: ['system_diagnostics'],
  task_control: ['task_control'],
  agent_runs: ['agent_run_ops'],
  thread_ops: ['prometheus_thread_ops'],
  audit_ops: ['prometheus_audit_ops'],
  request_ops: ['prometheus_request_ops'],
  scheduling: ['schedule_job'],
  memory: ['memory_provider_status'],
  skills: ['skill_list'],
  models: ['get_agent_models'],
  integrations: ['connection_ops'],
  business: ['list_entities'],
};

function round(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null;
}

function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]);
}

function distribution(values) {
  return { n: values.length, p50: percentile(values, 0.5), p75: percentile(values, 0.75), p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: percentile(values, 1) };
}

function url(pathname) {
  return new URL(pathname, baseUrl);
}

async function request(pathname, options = {}) {
  const method = options.method || 'GET';
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url(pathname), { ...options, signal: options.signal || AbortSignal.timeout(15_000) });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) throw new Error(`${method} ${pathname} ${response.status}`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt >= 3) break;
      // The local gateway can briefly rotate its listener during a restart.
      // Retry only this disposable benchmark setup/cleanup path; chat timing
      // remains measured from the actual SSE request and tool follow-up logic.
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`${method} ${pathname} failed after 3 attempts: ${String(lastError?.message || lastError)}`);
}

function safeTimingRows(traceId) {
  if (!fs.existsSync(timingPath)) return [];
  const lines = fs.readFileSync(timingPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines.slice(-50_000)) {
    try {
      const row = JSON.parse(line);
      if (row.turnId !== traceId) continue;
      const label = String(row.label || '');
      if (!label.startsWith('tool.') && !label.startsWith('runtime.') && !label.startsWith('model_worker_') && !label.startsWith('context_') && !label.startsWith('personality_') && !['request_received', 'admission_decided', 'client_final_sent', 'provider_request_start', 'first_visible_token', 'provider_done'].includes(label)) continue;
      rows.push({ traceId, label, elapsedMs: Number(row.elapsedMs), latencyElapsedMs: Number(row.latencyElapsedMs), telemetryId: row.telemetryId, toolCallId: row.toolCallId, toolFamily: row.toolFamily, toolName: row.toolName, round: row.round, eventCount: row.eventCount, resultBytes: row.resultBytes, resultTokens: row.resultTokens, totalTokens: row.totalTokens, error: row.error, errorCode: row.errorCode, code: row.code, queueWaitMs: row.queueWaitMs, durationMs: row.durationMs, eventBytes: row.eventBytes, totalEventCount: row.totalEventCount, rssBytes: row.rssBytes, pid: row.pid, requestBytes: row.requestBytes, includeWindows: row.includeWindows, windowCount: row.windowCount, monitorCount: row.monitorCount, cacheHit: row.cacheHit, deep: row.deep, timeoutMs: row.timeoutMs, attempt: row.attempt, attempts: row.attempts, debugPort: row.debugPort, profileKind: row.profileKind, doctorHealthCheck: row.doctorHealthCheck, observeMode: row.observeMode, outputBytes: row.outputBytes, transport: row.transport });
    } catch {}
  }
  return rows;
}

function safeUsageRows(traceId) {
  if (!fs.existsSync(usagePath)) return [];
  const lines = fs.readFileSync(usagePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines.slice(-50_000)) {
    try {
      const row = JSON.parse(line);
      if (row.traceId !== traceId) continue;
      rows.push({ provider: row.provider, model: row.model, callType: row.callType, phase: row.phase, source: row.source, inputTokens: row.inputTokens, outputTokens: row.outputTokens, reasoningTokens: row.reasoningTokens, cacheReadTokens: row.cacheReadTokens, cacheWriteTokens: row.cacheWriteTokens, totalTokens: row.totalTokens, durationMs: row.durationMs, estimatedProviderInputTokens: row.estimatedProviderInputTokens });
    } catch {}
  }
  return rows;
}

function extractToolRows(timingRows, benchmarkFamily) {
  const groups = new Map();
  for (const row of timingRows) {
    if (!row.telemetryId) continue;
    const current = groups.get(row.telemetryId) || { telemetryId: row.telemetryId, traceId: row.traceId, toolFamily: row.toolFamily, toolName: row.toolName, round: row.round, stages: {}, eventCount: 0, resultBytes: 0, resultTokens: 0, errors: 0 };
    const stage = row.label.slice('tool.'.length);
    current.stages[stage] = Number.isFinite(row.elapsedMs) ? row.elapsedMs : null;
    if (Number.isFinite(row.eventCount)) current.eventCount = Math.max(current.eventCount, row.eventCount);
    if (Number.isFinite(row.resultBytes)) current.resultBytes = Math.max(current.resultBytes, row.resultBytes);
    if (Number.isFinite(row.resultTokens)) current.resultTokens = Math.max(current.resultTokens, row.resultTokens);
    if (row.error === true || stage === 'failed' || stage === 'cancelled') current.errors += 1;
    groups.set(row.telemetryId, current);
  }
  return [...groups.values()].map((row) => {
    const s = row.stages;
    const diff = (a, b) => Number.isFinite(s[a]) && Number.isFinite(s[b]) ? Math.max(0, s[b] - s[a]) : null;
    return {
      telemetryId: row.telemetryId,
      traceId: row.traceId,
      // The production telemetry taxonomy is intentionally coarser than this
      // benchmark matrix (for example, models are grouped with subagent_task
      // and internal admin tools may be "other"). The controlled sample's
      // requested family is the authoritative attribution for aggregation.
      toolFamily: benchmarkFamily,
      toolName: row.toolName || 'unknown_tool',
      round: row.round,
      eventCount: row.eventCount,
      resultBytes: row.resultBytes,
      resultTokens: row.resultTokens,
      errors: row.errors,
      emittedToDispatchMs: diff('call_emitted', 'dispatch_start'),
      dispatchToFirstOutputMs: diff('dispatch_start', 'first_output'),
      firstOutputToCompleteMs: diff('first_output', 'complete'),
      completeToResultDeliveredMs: diff('complete', 'result_delivered'),
      resultToModelMs: diff('complete', 'result_to_model'),
      resultToNextVisibleMs: diff('result_to_model', 'next_visible_token'),
      toolWallMs: diff('call_emitted', 'complete'),
      serializationTransportMs: diff('result_serialized', 'result_delivered'),
      stages: s,
    };
  });
}

async function streamChat(sessionId, family, prompt) {
  const clientRequestId = `toolbench_${crypto.randomUUID()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('benchmark timeout')), timeoutMs);
  const startedAt = performance.now();
  const response = await fetch(url('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message: prompt,
      sessionId,
      clientRequestId,
      useTools: true,
      toolFilter: toolFilters[family] || undefined,
      memoryMode,
      origin: { channel: 'web', surface: 'desktop_app', device: 'computer', label: 'Tool performance benchmark', source: 'local_benchmark' },
    }),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`POST /api/chat ${response.status}`);
  const traceId = String(response.headers.get('x-prometheus-trace-id') || '').trim();
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstByteAt = null;
  let firstTokenAt = null;
  let doneAt = null;
  let terminalSeen = false;
  let streamError = '';
  const events = [];
  try {
    while (reader) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value?.byteLength && firstByteAt === null) firstByteAt = performance.now();
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        const type = String(event.type || '').trim();
        if (type === 'token' && firstTokenAt === null && String(event.text || '')) firstTokenAt = performance.now();
        if (type === 'done' || type === 'error') {
          doneAt ||= performance.now();
          terminalSeen = true;
          if (type === 'error') {
            const detail = event.error && typeof event.error === 'object'
              ? event.error.message
              : event.message || event.error;
            streamError = String(detail || 'gateway stream error');
          }
        }
        if (type === 'tool_call' || type === 'tool_progress' || type === 'tool_result' || type === 'latency_mark' || type === 'model_stream_event') {
          const telemetry = event.telemetry && typeof event.telemetry === 'object' ? event.telemetry : {};
          events.push({
            type,
            action: event.action ? String(event.action).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120) : undefined,
            telemetryId: event.telemetryId || telemetry.telemetryId,
            toolFamily: telemetry.toolFamily,
            eventCount: telemetry.eventCount,
            resultBytes: telemetry.resultBytes,
            resultTokens: telemetry.resultTokens,
            durationMs: event.durationMs || telemetry.toolWallMs,
            stage: event.stage,
            elapsedMs: event.elapsedMs,
          });
        }
      }
      if (terminalSeen) break;
    }
  } finally {
    clearTimeout(timer);
    if (terminalSeen) {
      try { await reader?.cancel?.(); } catch {}
    }
    reader?.releaseLock?.();
  }
  if (streamError) throw new Error(streamError);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const timingRows = safeTimingRows(traceId);
  return {
    traceId,
    clientRequestId,
    wallMs: round(performance.now() - startedAt),
    firstSseByteMs: firstByteAt === null ? null : round(firstByteAt - startedAt),
    firstTokenMs: firstTokenAt === null ? null : round(firstTokenAt - startedAt),
    clientDoneMs: doneAt === null ? null : round(doneAt - startedAt),
    eventCounts: Object.fromEntries([...new Set(events.map((event) => event.type))].map((type) => [type, events.filter((event) => event.type === type).length])),
    events,
    tools: extractToolRows(timingRows, family),
    timing: timingRows.filter((row) => !row.label.startsWith('tool.')),
    modelRounds: safeUsageRows(traceId),
  };
}

function hasExpectedTool(result, family) {
  const expected = expectedTools[family] || [];
  const actual = new Set((result?.tools || []).map((tool) => String(tool.toolName || '').trim()));
  return expected.length > 0 && expected.every((toolName) => actual.has(toolName));
}

function mergeStreamResults(initial, recovery, startedAt, family) {
  const all = recovery ? [initial, recovery] : [initial];
  const eventTypes = [...new Set(all.flatMap((result) => Object.keys(result.eventCounts || {})))];
  return {
    ...initial,
    traceIds: all.map((result) => result.traceId).filter(Boolean),
    wallMs: round(performance.now() - startedAt),
    clientDoneMs: round(performance.now() - startedAt),
    eventCounts: Object.fromEntries(eventTypes.map((type) => [type, all.reduce((sum, result) => sum + Number(result.eventCounts?.[type] || 0), 0)])),
    events: all.flatMap((result) => result.events || []),
    tools: all.flatMap((result) => result.tools || []),
    timing: all.flatMap((result) => result.timing || []),
    modelRounds: all.flatMap((result) => result.modelRounds || []),
    initialAttempt: {
      traceId: initial.traceId,
      wallMs: initial.wallMs,
      firstTokenMs: initial.firstTokenMs,
      clientDoneMs: initial.clientDoneMs,
      toolCount: (initial.tools || []).length,
      expectedToolSeen: hasExpectedTool(initial, family),
    },
    recoveryAttempt: recovery ? {
      traceId: recovery.traceId,
      wallMs: recovery.wallMs,
      firstTokenMs: recovery.firstTokenMs,
      clientDoneMs: recovery.clientDoneMs,
      toolCount: (recovery.tools || []).length,
      expectedToolSeen: hasExpectedTool(recovery, family),
    } : null,
  };
}

async function runOne(family, sample) {
  const sessionId = `toolbench_${family}_${Date.now().toString(36)}_${sample}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const startedAt = performance.now();
  try {
    await request('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sessionId, channel: 'web', title: `Tool benchmark ${family}` }) });
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId, model, reasoningEffort }),
    });
    const initial = await streamChat(sessionId, family, prompts[family]);
    let recovery = null;
    let recovered = false;
    if (!hasExpectedTool(initial, family)) {
      const followupPrompt = `Follow-up recovery for the same controlled benchmark: the required tool call was not emitted in the first attempt. Perform the required read-only ${expectedTools[family].join(' and ')} tool call now using the exact safe instructions above. Do not summarize before calling it, do not ask a question, do not call ask_prometheus_questions, and do not use any other tool. After the required tool call(s), reply briefly and finish.`;
      recovery = await streamChat(sessionId, family, followupPrompt);
      recovered = hasExpectedTool(recovery, family);
    }
    return { family, sample, ok: true, setupToDoneMs: round(performance.now() - startedAt), attempts: recovery ? 2 : 1, recovered, ...mergeStreamResults(initial, recovery, startedAt, family) };
  } catch (error) {
    return { family, sample, ok: false, setupToDoneMs: round(performance.now() - startedAt), error: String(error?.message || error) };
  } finally {
    try { await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }); } catch {}
  }
}

function aggregate(samples) {
  const rows = samples.filter((sample) => sample.ok);
  const byFamily = {};
  for (const family of requestedFamilies) {
    const familySamples = rows.filter((sample) => sample.family === family);
    // The SSE trace and timing-log turn identifiers are intentionally allowed
    // to differ across gateway transports. The sample already carries the
    // normalized tool rows, so aggregate directly from those rows instead of
    // joining on an identifier that can be rewritten by a retry/recovery.
    const familyRows = familySamples.flatMap((sample) => sample.tools || [])
      .filter((row) => row.toolFamily === family || (family === 'mcp_connector' && row.toolFamily === 'mcp_connector'));
    byFamily[family] = {
      samples: familySamples.length,
      toolCalls: familyRows.length,
      toolWallMs: distribution(familyRows.map((row) => row.toolWallMs)),
      submitToAcceptedMs: distribution(rows.filter((sample) => sample.family === family).map((sample) => sample.timing.find((row) => row.label === 'admission_decided')?.elapsedMs)),
      acceptedToToolCallMs: distribution(familyRows.map((row) => {
        const sample = rows.find((candidate) => candidate.tools?.some((tool) => tool.telemetryId === row.telemetryId));
        const emitted = row.stages?.call_emitted;
        const accepted = sample?.timing?.find((timing) => timing.traceId === row.traceId && timing.label === 'admission_decided')?.elapsedMs;
        return Number.isFinite(emitted) && Number.isFinite(accepted) ? Math.max(0, emitted - accepted) : null;
      })),
      dispatchToFirstOutputMs: distribution(familyRows.map((row) => row.dispatchToFirstOutputMs)),
      firstOutputToCompleteMs: distribution(familyRows.map((row) => row.firstOutputToCompleteMs)),
      completeToResultDeliveredMs: distribution(familyRows.map((row) => row.completeToResultDeliveredMs)),
      resultToModelMs: distribution(familyRows.map((row) => row.resultToModelMs)),
      resultToNextVisibleMs: distribution(familyRows.map((row) => row.resultToNextVisibleMs)),
      resultBytes: distribution(familyRows.map((row) => row.resultBytes)),
      eventCount: distribution(familyRows.map((row) => row.eventCount)),
      errors: familyRows.reduce((sum, row) => sum + Number(row.errors || 0), 0),
      modelRounds: familySamples.flatMap((sample) => sample.modelRounds || []).map((round) => ({ provider: round.provider, model: round.model, inputTokens: round.inputTokens, outputTokens: round.outputTokens, totalTokens: round.totalTokens, durationMs: round.durationMs })),
    };
  }
  return { byFamily, endToEnd: distribution(rows.map((sample) => sample.clientDoneMs || sample.wallMs)), firstVisibleToken: distribution(rows.map((sample) => sample.firstTokenMs)), errors: samples.filter((sample) => !sample.ok).length };
}

const samples = [];
for (const family of requestedFamilies) {
  if (!prompts[family]) continue;
  for (let sample = 1; sample <= samplesPerFamily; sample += 1) {
    process.stderr.write(`[tool-benchmark] ${family} sample ${sample}/${samplesPerFamily}\n`);
    samples.push(await runOne(family, sample));
  }
}

const report = {
  benchmark: 'prometheus-tool-performance',
  capturedAt: new Date().toISOString(),
  conditions: {
    baseUrl: baseUrl.origin,
    provider: providerId,
    model,
    reasoningEffort,
    explicitCategoryRequests,
    memoryMode,
    samplesPerFamily,
    platform: process.platform,
    release: os.release(),
    node: process.version,
    timingPath: path.relative(root, timingPath),
    privacy: 'No prompt, message, token, credential, file content, page content, or tool result content is emitted; only IDs, categories, counts, byte lengths, and timings are retained.',
  },
  aggregate: aggregate(samples),
  samples,
};
console.log(JSON.stringify(process.env.PROMETHEUS_TOOL_BENCH_SUMMARY_ONLY === '1'
  ? { benchmark: report.benchmark, capturedAt: report.capturedAt, conditions: report.conditions, aggregate: report.aggregate }
  : report, null, 2));
