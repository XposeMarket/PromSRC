import type { ToolResult } from '../tool-builder';

export interface TurnDigestOptions {
  reason: string;
  cause?: string;
  partialText?: string;
  userRequest?: string;
  maxChars?: number;
}

type DigestToolResult = Pick<ToolResult, 'name' | 'args' | 'result' | 'error'>;

const oneLine = (value: unknown, limit: number): string => {
  const text = String(value ?? '').replace(/\u2014/g, '-').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : text;
};

export function describeTurnCutoffCause(reason: string, cause?: string): string {
  const detail = oneLine(cause, 140);
  if (reason === 'max_tokens') return 'the model hit its output limit';
  if (reason === 'incomplete_stream' || reason === 'CODEX_INCOMPLETE_STREAM') {
    if (detail === 'invalid_tool_json' || detail === 'tool_block_unterminated') return 'tool calls kept arriving with broken arguments';
    return `the response stream kept dropping${detail && detail !== 'incomplete_stream' ? ` (${detail})` : ''}`;
  }
  if (reason === 'provider_failure') return `the provider call failed${detail ? `: ${detail}` : ''}`;
  return `the model did not finish its response${reason ? ` (${oneLine(reason, 90)})` : ''}`;
}

function argHint(args: unknown): string {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    for (const key of ['path', 'file', 'filename', 'command', 'query', 'url', 'action', 'prompt']) {
      if (record[key] != null && record[key] !== '') return oneLine(`${key}: ${record[key]}`, 90);
    }
  }
  if (args == null) return '';
  try { return oneLine(typeof args === 'string' ? args : JSON.stringify(args), 90); }
  catch { return oneLine(args, 90); }
}

function toolLine(tool: DigestToolResult, count = 1): string {
  const name = oneLine(tool?.name || 'unknown tool', 90);
  const hint = argHint(tool?.args);
  const result = oneLine(tool?.result || '(no result text)', 220);
  return `- ${name}${hint ? ` (${hint})` : ''}: ${tool?.error ? 'failed' : 'ok'} - ${result}${count > 1 ? ` (repeated ${count} times)` : ''}`;
}

export function buildDeterministicTurnDigest(toolResults: readonly DigestToolResult[], opts: TurnDigestOptions): string {
  const cause = describeTurnCutoffCause(opts.reason, opts.cause);
  const maxChars = Math.max(0, Math.floor(opts.maxChars ?? 6000));
  const footer = "Say 'continue' and I'll pick up from here.";
  const grouped: Array<{ tool: DigestToolResult; signature: string; count: number }> = [];
  for (const tool of toolResults || []) {
    const signature = JSON.stringify([tool?.name, tool?.args, tool?.error, tool?.result]);
    const previous = grouped[grouped.length - 1];
    if (previous?.signature === signature) previous.count++;
    else grouped.push({ tool, signature, count: 1 });
  }
  const visible = grouped.length > 25
    ? [...grouped.slice(0, 5), null, ...grouped.slice(-20)]
    : grouped;
  const entries = visible.map(item => item === null
    ? `- ... ${grouped.length - 25} more`
    : toolLine(item.tool, item.count));
  const lastTool = toolResults?.[toolResults.length - 1];
  const partial = oneLine(opts.partialText, 500);
  const last = [lastTool ? `Last tool: ${toolLine(lastTool).slice(2)}` : 'No tool was run.', partial ? `Partial assistant text: ${partial}` : ''].filter(Boolean).join('\n');
  const header = `## Turn cut off: ${cause}`;
  const body = `\n\n### What got done\n${entries.length ? entries.join('\n') : '- No tool results were saved.'}\n\n### Last thing I was doing\n${last}\n\n${footer}`;
  const full = header + body;
  if (full.length <= maxChars) return full;
  // Keep the cause and recovery instruction even when individual tool results are huge.
  if (maxChars < header.length + footer.length + 3) return full.slice(0, maxChars);
  const available = maxChars - header.length - footer.length - 5;
  return `${header}\n\n${body.slice(2, 2 + available).trimEnd()}\n\n${footer}`.slice(0, maxChars);
}

export type DigestProviderCall = (
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  options: { tools: []; num_predict: number; abortSignal: AbortSignal },
) => Promise<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;

export async function attemptModelDigest(
  toolResults: readonly DigestToolResult[],
  opts: TurnDigestOptions & { providerCall: DigestProviderCall; abortSignal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  if (opts.abortSignal?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  opts.abortSignal?.addEventListener('abort', abort, { once: true });
  const timeoutMs = Math.max(1, opts.timeoutMs ?? 45_000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const recent = (toolResults || []).slice(-6).map((tool, index) =>
      `${index + 1}. ${oneLine(tool.name, 90)} (${argHint(tool.args)}), ${tool.error ? 'failed' : 'ok'}: ${oneLine(tool.result, 1500)}`,
    ).join('\n');
    const cause = describeTurnCutoffCause(opts.reason, opts.cause);
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: `Your turn was cut off by ${cause}. Using only the tool results below, write the user a short status: what was completed (with evidence), what is unfinished, and the exact next step. No tool calls. No em dashes. Do not claim a task was completed merely because a tool ran.` },
      { role: 'user', content: `User request: ${oneLine(opts.userRequest, 500)}\n\nSaved status:\n${buildDeterministicTurnDigest(toolResults, opts)}\n\nRecent tool results:\n${recent}` },
    ];
    const result = await Promise.race([
      opts.providerCall(messages, { tools: [], num_predict: 1200, abortSignal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('Digest timed out')); }, timeoutMs);
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Digest aborted')), { once: true })),
    ]);
    if (controller.signal.aborted || result?.message?.tool_calls?.length) return null;
    const text = String(result?.message?.content || '').trim().replace(/\u2014/g, '-');
    return text || null;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    opts.abortSignal?.removeEventListener('abort', abort);
  }
}
