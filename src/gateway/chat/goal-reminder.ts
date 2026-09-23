/**
 * Mid-turn goal reminders used to be appended to every 12th tool result.
 * They were retired because:
 * - the model already has the user's request at the top of the turn, so the
 *   reminder carried no new information;
 * - injecting text into a tool result changes that message's bytes, which is
 *   visible noise to the user in the tool stream and, once the result ages
 *   into the elision window, adds churn to the provider prompt-cache prefix.
 *
 * The export stays so existing call sites compile and can be removed later.
 */
export function goalReminderForTool(_message: string, _completedToolCount: number): string {
  return '';
}
