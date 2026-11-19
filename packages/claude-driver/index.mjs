// Dependency island: keep the SDK's Zod 4 separate from the application's Zod 3.
// The caller must always provide the user's installed executable.
import { query } from '@anthropic-ai/claude-agent-sdk';
export function createQuery(input) {
  if (!input?.options?.pathToClaudeCodeExecutable) throw new Error('An installed Claude Code executable is required.');
  return query(input);
}
