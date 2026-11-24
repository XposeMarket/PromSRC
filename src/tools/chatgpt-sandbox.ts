/**
 * chatgpt_sandbox: lets any Prometheus model (Claude, Sol, local...) delegate a
 * job to ChatGPT's own native tools through the connected OpenAI Codex login:
 * its Python sandbox (a Linux VM with /mnt/data), its web search, and its
 * file/chart generation. Files the delegate writes are copied back into the
 * workspace (chatgpt-files/) by the ChatGPT web adapter.
 *
 * Each call is one fresh ChatGPT turn (15-90s). The sandbox does not persist
 * between calls, so a task must be self-contained.
 */

import { buildProviderById } from '../providers/factory';

export const CHATGPT_SANDBOX_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'chatgpt_sandbox',
    description:
      'Delegate a self-contained job to ChatGPT\'s own tools through the connected OpenAI Codex login: '
      + 'a Python sandbox (Linux VM, pip, /mnt/data), web search, and file/chart generation. '
      + 'Use for heavy computation, data analysis or plotting away from this PC. '
      + 'Files it writes to /mnt/data come back under chatgpt-files/. '
      + 'Each call is a fresh 15-90s turn with a fresh sandbox, so put all data and instructions in the task. It cannot see local files.',
    parameters: {
      type: 'object',
      required: ['task'],
      properties: {
        task: { type: 'string', description: 'Complete instructions: which tool to use (python / web search) and which files to produce.' },
        mode: {
          type: 'string',
          enum: ['instant', 'thinking', 'extended', 'heavy', 'pro'],
          description: 'Default thinking. instant is unreliable for multi-step tool work; pro is slowest.',
        },
      },
    },
  },
} as const;

const MODE_TO_EFFORT: Record<string, string> = {
  instant: 'low',
  thinking: 'high',
  extended: 'xhigh',
  heavy: 'max',
  pro: 'ultra',
};

export async function executeChatGPTSandbox(args: any, options: { abortSignal?: AbortSignal; accountId?: string } = {}): Promise<{ result: string; error: boolean }> {
  const task = String(args?.task || '').trim();
  if (!task) return { result: 'chatgpt_sandbox needs a task.', error: true };
  const mode = String(args?.mode || 'thinking').toLowerCase();
  const effort = MODE_TO_EFFORT[mode] || 'high';
  const started = Date.now();
  const toolNotes: string[] = [];
  try {
    const provider: any = buildProviderById('openai_codex', options.accountId || 'default');
    const result = await provider.chat(
      [
        {
          role: 'system',
          content: 'You are a delegate executing a job for another AI agent. Use your own native tools (python, web search) as needed. '
            + 'Save every deliverable file under /mnt/data and link each one in your answer as sandbox:/mnt/data/<name> so it can be downloaded. '
            + 'Answer with the results, key numbers, and file links. Be concise.',
        },
        { role: 'user', content: task },
      ],
      'chatgpt',
      {
        think: effort,
        chatgptNoBridge: true,
        abortSignal: options.abortSignal,
        onModelEvent: (event: any) => {
          if (event?.nativeType === 'chatgpt.tool_start' && event?.data?.name) toolNotes.push(String(event.data.name));
        },
      } as any,
    );
    const text = String(result?.message?.content || '').trim();
    const used = [...new Set(toolNotes)];
    const header = `[chatgpt_sandbox mode=${mode} model=${result?.actualModel || 'chatgpt'} ${Math.round((Date.now() - started) / 1000)}s${used.length ? ` tools=${used.join(',')}` : ''}]`;
    return { result: `${header}\n${text}`, error: false };
  } catch (error: any) {
    const msg = String(error?.message || error);
    const hint = /Not connected|Reconnect/i.test(msg) ? ' Connect OpenAI Codex in Settings -> Models first.' : '';
    return { result: `chatgpt_sandbox failed: ${msg}${hint}`, error: true };
  }
}
