// Skill activation window state — extracted from server-v2.ts (Step 19.1 + 18.1).

import { SkillsManager } from './skills-manager';
import { type SkillWindow } from '../prompt-context';

const skillActivationWindows = new Map<string, Map<string, SkillWindow>>();

export function getSessionSkillWindows(sessionId: string): Map<string, SkillWindow> {
  if (!skillActivationWindows.has(sessionId)) {
    skillActivationWindows.set(sessionId, new Map());
  }
  return skillActivationWindows.get(sessionId)!;
}

export const sessionCurrentTurn = new Map<string, number>();

let _skillsManager: InstanceType<typeof SkillsManager> | null = null;

export function initSkillWindows(
  skillsManager: InstanceType<typeof SkillsManager>,
  _skillsDir: string,
  _fallbackSkillsDir: string,
): void {
  _skillsManager = skillsManager;
}

/** Legacy hook — multi-agent orchestration skill removed; always false. */
export function isOrchestrationSkillEnabled(): boolean {
  return false;
}

let _recoverFn: (() => void) | null = null;
export function setSkillRecoveryFn(fn: () => void): void { _recoverFn = fn; }

export function recoverSkillsIfEmpty(): void {
  if (!_skillsManager) return;
  if (_skillsManager.getAll().length > 0) return;
  _skillsManager.scanSkills();
  if (_skillsManager.getAll().length > 0) return;
  if (_recoverFn) _recoverFn();
}

/** No-op — legacy orchestration config sync removed. */
export function setOrchestrationEnabled(_enabled: boolean): void {}

/** No-op — legacy orchestration config sync removed. */
export function syncOrchestrationOnStartup(): void {}
