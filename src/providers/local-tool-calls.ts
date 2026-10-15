/** Conservative fallback for Qwen/Hermes servers that emit tool calls as text.
 * Only explicit envelopes are accepted, only advertised tools may be invoked,
 * and native tool calls always take precedence at the adapter boundary.
 */
import type { ToolCall } from './LLMProvider';

export function parseTextToolCalls(text: string, allowedNames?: ReadonlySet<string>): ToolCall[] {
  const calls: ToolCall[] = [];
  const visible = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  const envelopes = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|```(?:json|tool_call)\s*\n([\s\S]*?)\n```/gi;
  for (const match of visible.matchAll(envelopes)) {
    try {
      const parsed = JSON.parse(match[1] ?? match[2]);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        const fn = item?.function ?? item;
        if (typeof fn?.name !== 'string' || !/^[\w.-]+$/.test(fn.name)) continue;
        if (allowedNames && !allowedNames.has(fn.name)) continue;
        let args = fn.arguments ?? fn.parameters;
        if (typeof args === 'string') args = JSON.parse(args);
        if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
        calls.push({ id: `local_text_${calls.length}`, type: 'function', function: { name: fn.name, arguments: JSON.stringify(args) } });
      }
    } catch { /* Malformed/truncated output is ordinary text, never executable. */ }
  }
  return calls;
}

export function recoverLocalToolCalls(text: string, native: ToolCall[] | undefined, tools: any[] | undefined): ToolCall[] | undefined {
  if (native?.length) return native;
  if (!tools?.length) return undefined;
  const names = new Set<string>(tools.map(t => t?.function?.name ?? t?.name).filter((n): n is string => typeof n === 'string'));
  const recovered = parseTextToolCalls(text, names);
  return recovered.length ? recovered : undefined;
}
