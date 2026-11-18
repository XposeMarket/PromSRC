import { createHash } from 'node:crypto';
import type { ChatMessage, ProviderReplay } from './LLMProvider';
import { historyImageKeepFromEnv, PRUNED_IMAGE_TEXT } from './history-image-prune';

/** Stale screenshots (count, base64 chars) tolerated in the stored prefix before it is rewritten. */
export const CONTINUATION_STALE_IMAGE_SLACK = 8;
export const CONTINUATION_STALE_IMAGE_SLACK_BYTES = 4_000_000;

function slackFromEnv(name: string, fallback: number): number {
  const n = Number(String(process.env[name] ?? '').trim() || NaN);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

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

type StoredImage = { block: any; bytes: number };

/** Only the gateway's own "[SYSTEM: ...]" vision messages count as runtime screenshots here.
 * The broader runtime-tag match would also catch a person's caption such as
 * "[BUG_REPORT] compare this" and swap out the attachment they asked about. */
function isRuntimeScreenshotMessage(message: any): boolean {
  const first = message.content.find((block: any) => block?.type === 'text' && typeof block.text === 'string');
  return /^\s*\[SYSTEM:/.test(first?.text || '');
}

/** Tool and runtime screenshots in one stored wire message, oldest first. A
 * person's own attachments are never listed, so they stay for the whole turn. */
function prunableImages(message: any): StoredImage[] {
  const found: StoredImage[] = [];
  if (message?.role !== 'user' || !Array.isArray(message.content)) return found;
  const runtime = isRuntimeScreenshotMessage(message);
  const visit = (block: any) => {
    if (block?.type === 'image') found.push({ block, bytes: String(block.source?.data || '').length });
  };
  for (const block of message.content) {
    if (block?.type === 'tool_result' && Array.isArray(block.content)) block.content.forEach(visit);
    else if (runtime) visit(block);
  }
  return found;
}

/** How many of the oldest stored screenshots are sent as a text note.
 *
 * The stored prefix keeps every image exactly as it was first sent, so without
 * a bound each browser/desktop round uploads every earlier screenshot again.
 * Rewriting the prefix is not free either: thinking after the first rewritten
 * image no longer matches its prefix (the API drops it) and the prompt cache
 * restarts there. So the cutoff moves in steps. Nothing changes until `slack`
 * stale images, or `slackBytes` of them, sit behind the newest `keep`; then all
 * of them go at once. `sizesByRound` is the stored rounds in order, and every
 * round and every model worker replays the same rounds, so each one computes
 * the same cutoff and the request stays append-only between steps. */
export function staleImageCutoff(
  sizesByRound: number[][], keep: number,
  slack = CONTINUATION_STALE_IMAGE_SLACK, slackBytes = CONTINUATION_STALE_IMAGE_SLACK_BYTES,
): number {
  if (keep <= 0) return 0;
  const sizes: number[] = [];
  let cutoff = 0;
  for (const round of sizesByRound) {
    sizes.push(...round);
    const end = sizes.length - keep;
    if (end <= cutoff) continue;
    let bytes = 0;
    for (let i = cutoff; i < end; i += 1) bytes += sizes[i];
    if (end - cutoff >= slack || bytes >= slackBytes) cutoff = end;
  }
  return cutoff;
}

function withImageNotes(message: any, images: StoredImage[], count: number) {
  const stale = new Set(images.slice(0, Math.max(0, count)).map(image => image.block));
  if (!stale.size) return message;
  const note = (block: any) => stale.has(block) ? { type: 'text', text: PRUNED_IMAGE_TEXT } : block;
  return {
    ...message,
    content: message.content.map((block: any) => block?.type === 'tool_result' && Array.isArray(block.content)
      ? { ...block, content: block.content.map(note) } : note(block)),
  };
}

/** Store each accepted request's new input once. Reassemble the same prefix
 * in any model worker, even if this round's image pruning or prompt changed.
 * Stored inputs are never edited; old screenshots are swapped for a note only
 * in the assembled request (see staleImageCutoff). */
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
    const stored = rounds.map(round => round.anthropic!.input.map(prunableImages));
    const cutoff = staleImageCutoff(
      stored.map(round => round.flat().map(image => image.bytes)),
      historyImageKeepFromEnv(),
      slackFromEnv('PROMETHEUS_CONTINUATION_IMAGE_SLACK', CONTINUATION_STALE_IMAGE_SLACK),
      slackFromEnv('PROMETHEUS_CONTINUATION_IMAGE_SLACK_BYTES', CONTINUATION_STALE_IMAGE_SLACK_BYTES),
    );
    let seenImages = 0;
    for (const [roundIndex, round] of rounds.entries()) {
      for (const [messageIndex, message] of round.anthropic!.input.entries()) {
        const images = stored[roundIndex][messageIndex];
        prefix.push(withImageNotes(message, images, cutoff - seenImages));
        seenImages += images.length;
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
