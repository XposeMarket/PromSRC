/**
 * Which execution modes load stored session history into the model context.
 *
 * Team-manager turns never load stored `team_coord_<teamId>` history: that history can hold obsolete
 * "[Interrupted by gateway restart]" checkpoints that read as instructions. A manager turn gets its
 * context from the coordinator prompt, team state and team chat instead. Cron stays isolated the same way.
 * Interactive and other modes keep stored history.
 */
export function shouldOmitStoredHistory(executionMode: string | null | undefined): boolean {
  return executionMode === 'cron' || executionMode === 'team_manager';
}
