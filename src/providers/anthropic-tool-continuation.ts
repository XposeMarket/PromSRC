import { createHash } from 'node:crypto';
import type { ChatMessage, ProviderReplay } from './LLMProvider';

export function checksThinkingPrefix(model: string): boolean {
  return /^claude-(?:(?:opus|sonnet|haiku)-5-5|(?:fable|mythos)-5-[12])(?:-|$)/.test(model);
}

export function addAnthropicBeta(headers: Record<string, string>, beta: string): void {
  const betas = new Set((headers['anthropic-beta'] || '').split(',').filter(Boolean));
  betas.add(beta);
  headers['anthropic-beta'] = [...betas].join(',');
}

export function logInputTransformations(entries: any): void {
  if (!Array.isArray(entries) || !entries.length) return;
  console.info('[anthropic] input_transformations', entries.map(({ type, path, reason }) => ({ type, path, reason })));
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function withoutCacheControl(block: any) {
  const { cache_control, ...content } = block;
  return content;
}

function toolDefinitions(tools: any[] = []): Map<string, any> {
  return new Map(tools.map(tool => [tool.name, withoutCacheControl(tool)]));
}

/** Store each accepted request's new input once. Reassemble the exact prefix
 * in any model worker, even if this round's image pruning or prompt changed. */
export function prepareAnthropicContinuation(
  body: any, headers: Record<string, string>, messages: ChatMessage[],
  model: string, provider: string, account: string, volatileHeader: string,
) {
  const rounds: ProviderReplay[] = [];
  for (const message of messages) {
    if (!message.tool_calls?.length) continue;
    const replay = message.providerReplay;
    if (!replay?.anthropic || replay.model !== model || replay.provider !== provider || replay.account !== account) {
      rounds.length = 0;
      continue;
    }
    if (replay.anthropic.base) rounds.length = 0;
    if (rounds.length || replay.anthropic.base) rounds.push(replay);
  }

  const previous = rounds.at(-1);
  const root = rounds[0]?.anthropic?.base;
  const anchor = previous ? body.messages.findIndex((m: any) => m.content === previous.blocks) : -1;
  const systemHash = digest(body.system);
  const last = body.messages.at(-1);
  const volatile = Array.isArray(last?.content) ? last.content.at(-1) : null;
  const volatileHash = volatile?.text?.startsWith(volatileHeader) ? digest(volatile.text) : '';
  let start = 0;
  if (root && anchor >= 0 && previous?.anthropic) {
    const suffix = body.messages.slice(anchor + 1);
    const active = toolDefinitions(root.tools);
    const prefix: any[] = [];
    let usesInlineTools = false;
    for (const round of rounds) {
      for (const message of round.anthropic!.input) {
        prefix.push(message);
        if (message.role !== 'system') continue;
        for (const block of message.content) {
          if (block.type === 'tool_addition') {
            active.set(block.tool.definition.name, block.tool.definition);
            usesInlineTools = true;
          }
          if (block.type === 'tool_removal') {
            active.delete(block.tool.name);
            usesInlineTools = true;
          }
        }
      }
      prefix.push({ role: 'assistant', content: round.blocks });
    }
    if (volatileHash && volatileHash === previous.anthropic.volatileHash) {
      suffix[suffix.length - 1] = { ...last, content: last.content.slice(0, -1) };
    }
    const current = toolDefinitions(body.tools);
    const changes: any[] = [];
    for (const name of active.keys()) {
      if (!current.has(name)) changes.push({ type: 'tool_removal', tool: { type: 'tool_reference', name } });
    }
    for (const [name, definition] of current) {
      if (JSON.stringify(active.get(name)) !== JSON.stringify(definition)) {
        changes.push({ type: 'tool_addition', tool: { type: 'tool_definition', definition } });
      }
    }
    if (usesInlineTools || changes.length) addAnthropicBeta(headers, 'inline-tools-2026-09-15');
    if (systemHash !== previous.anthropic.systemHash) {
      for (const block of body.system || []) if (block.type === 'text') changes.push(withoutCacheControl(block));
    }
    if (changes.length) suffix.push({ role: 'system', content: changes });
    body.messages = prefix.concat(suffix);
    body.system = root.system;
    body.tools = root.tools;
    start = prefix.length;
  }
  const stableTools = body.tools;
  const stableSystem = body.system;
  return (): NonNullable<ProviderReplay['anthropic']> => {
    // A provider quota retry can explicitly replace the prefix. The accepted
    // request becomes a new root, and drop_block handles earlier signatures.
    const base = start === 0 || stableTools !== body.tools || stableSystem !== body.system;
    const input = body.messages.slice(base ? 0 : start).map((m: any) => ({
      ...m, content: Array.isArray(m.content) ? m.content.map(withoutCacheControl) : m.content,
    }));
    return { ...(base ? { base: { system: body.system, tools: body.tools } } : {}), input, systemHash, volatileHash };
  };
}
