export type SelfReflectionMode = 'general' | 'schedule';

export interface SelfReflectionInstructionOptions {
  availableTools?: Iterable<string> | null;
  mode?: SelfReflectionMode;
}

function normalizeToolNames(input?: Iterable<string> | null): Set<string> {
  const out = new Set<string>();
  if (!input) return out;
  for (const raw of input) {
    const name = String(raw || '').trim().toLowerCase();
    if (name) out.add(name);
  }
  return out;
}

export function buildSelfReflectionInstruction(
  options: SelfReflectionInstructionOptions = {},
): string {
  const mode: SelfReflectionMode = options.mode === 'schedule' ? 'schedule' : 'general';
  const toolNames = normalizeToolNames(options.availableTools);

  if (toolNames.has('write_note')) {
    const tag = mode === 'schedule' ? 'last_run_insight' : 'run_insight';
    return `\n\n---
AFTER completing your main task, you MUST call write_note once with a brief self-reflection:
  write_note({
    "content": "<1-2 sentences: what worked, what was tricky, any pattern you noticed>",
    "tag": "${tag}"
  })
This helps you improve on future runs. Do not skip this step.
---`;
  }

  if (toolNames.has('memory_write')) {
    const category = mode === 'schedule' ? 'schedule_run_insights' : 'run_insights';
    return `\n\n---
AFTER completing your main task, you MUST call memory_write once with a brief self-reflection:
  memory_write({
    "file": "user",
    "category": "${category}",
    "content": "<1-2 sentences: what worked, what was tricky, any pattern you noticed>"
  })
This helps you improve on future runs. Do not skip this step.
---`;
  }

  return '';
}
