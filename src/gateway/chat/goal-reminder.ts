/** Keep long turns oriented without repeating the same user text after every tool. */
export function goalReminderForTool(message: string, completedToolCount: number): string {
  if (!Number.isInteger(completedToolCount) || completedToolCount < 12 || completedToolCount % 12 !== 0) return '';
  const goal = String(message || '').replace(/\s+/g, ' ').trim();
  if (goal.length < 24 || goal.split(/\s+/).length < 5) return '';
  return `\n\n[GOAL REMINDER: Your task is still: "${goal.slice(0, 120)}". Stay focused on this goal only.]`;
}
