// Redo onboarding is a soft replay of onboarding guidance.
//
// It MUST NOT be a factory reset. The user's chats, projects, memory, Brain
// artifacts, teams, schedules, skills, generated files, and profile documents
// are durable local data and survive onboarding replay.

import * as path from 'path';
import { ensurePublicWorkspaceScaffold } from '../../config/public-workspace';
import { replayTutorial } from './onboarding-store';

function workspaceDir(): string {
  return process.env.PROMETHEUS_WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
}

export interface RedoResult {
  /** Kept for API compatibility. Soft onboarding replay removes no user data. */
  removed: string[];
  errors: string[];
}

export function redoOnboarding(userId: string): RedoResult {
  const ws = workspaceDir();
  const errors: string[] = [];

  // Recreate any missing factory/bootstrap documents additively. Existing
  // profile files remain byte-for-byte untouched. In a normal completed install
  // this primarily restores BOOTSTRAP.md so onboarding has an editable guide.
  try {
    ensurePublicWorkspaceScaffold(ws);
  } catch (e: any) {
    errors.push('scaffold_refresh: ' + String(e?.message || e));
  }

  // Replay onboarding state while retaining the configured model connection.
  // This intentionally does not clear persisted chats, runtime stores, or
  // workspace files. A future factory-reset operation must be a separate,
  // explicitly destructive API with its own confirmation boundary.
  try {
    replayTutorial(userId);
  } catch (e: any) {
    errors.push('onboarding_replay: ' + String(e?.message || e));
  }

  return { removed: [], errors };
}
