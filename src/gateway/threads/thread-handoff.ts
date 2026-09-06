/** Preserve the actual assignment: a supervision objective must never replace it. */
export function managedPrompt(
  prompt: string,
  objective: string,
  follow: boolean,
  acceptanceCriteria = '',
  ownerSessionId = '',
): string {
  const assignment = String(prompt || '').trim();
  const summary = String(objective || '').trim();
  const work = assignment || summary;
  if (!work) return '';
  const sections = [work];
  if (assignment && summary && summary !== assignment) sections.push(`[OBJECTIVE]\n${summary}`);
  const checks = String(acceptanceCriteria || '').trim();
  if (checks && checks !== work && checks !== summary) sections.push(`[ACCEPTANCE CRITERIA]\n${checks}`);
  sections.push('[HANDOFF CONTEXT BOUNDARY]\nYou do not inherit the sender conversation. Treat supplied findings as reported evidence, not independently verified facts. Verify relevant source and state before changing anything. If essential details are missing, retrieve evidence or ask the sender rather than inventing the plan.');
  if (ownerSessionId) sections.push(`Source session: ${ownerSessionId}`);
  const result = sections.join('\n\n');
  return follow && !/^\/goal(?:\s|$)/i.test(work) ? `/goal ${result}` : result;
}
