// Decides whether an install was already in real use before first-start
// tracking existed. Called exactly once, when the install's onboarding record
// is first created. A positive result grandfathers the install as onboarded so
// upgrading users (or users whose onboarding.json moved/was lost) never get
// the first-run flow on a restart.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getConfig } from '../../config/config';
import { getPrometheusLayout } from '../../runtime/storage-layout.js';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function countUserSessions(dir: string): number {
  return safe(() => fs.readdirSync(dir)
    .filter(name => name.endsWith('.json') && !name.startsWith('_') && !/regression|toolbench|smoke/i.test(name))
    .length, 0);
}

function legacyOnboardingCompleted(file: string): boolean {
  return safe(() => {
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.values(parsed?.users || {}).some((rec: any) =>
      !!(rec?.completedAt || rec?.tutorial?.completedAt || rec?.model?.firstConnectedAt));
  }, false);
}

export interface ExistingInstallProbe {
  sessionsDirs?: string[];
  legacyOnboardingFiles?: string[];
  hasModelCredential?: () => boolean;
  hasAccountSession?: () => boolean;
}

function defaultProbe(): Required<ExistingInstallProbe> {
  const configDir = safe(() => getConfig().getConfigDir(), '');
  const layout = safe(() => getPrometheusLayout(), null as any);
  const sessionsDirs = Array.from(new Set([
    configDir ? path.join(configDir, 'sessions') : '',
    layout?.runtime?.sessions || '',
  ].filter(Boolean)));
  const legacyOnboardingFiles = Array.from(new Set([
    path.join(os.homedir(), '.prometheus', 'onboarding.json'),
    process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, 'onboarding.json') : '',
    configDir ? path.join(configDir, 'onboarding.json') : '',
  ].filter(Boolean)));
  return {
    sessionsDirs,
    legacyOnboardingFiles,
    hasModelCredential: () => safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const openai = require('../../auth/openai-oauth');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const anthropic = require('../../auth/anthropic-oauth');
      return !!(openai.isConnected?.(configDir) || anthropic.isConnected?.(configDir));
    }, false),
    hasAccountSession: () => safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return !!require('../routes/account.router').hasAccountSession?.();
    }, false),
  };
}

/** Returns a reason string when the install is pre-existing, else null. */
export function detectExistingInstall(probe: ExistingInstallProbe = {}): string | null {
  const p = { ...defaultProbe(), ...probe };
  for (const file of p.legacyOnboardingFiles) {
    if (legacyOnboardingCompleted(file)) return 'legacy_onboarding_record';
  }
  if (p.hasAccountSession()) return 'account_session';
  if (p.hasModelCredential()) return 'model_credential';
  const sessions = p.sessionsDirs.reduce((sum, dir) => sum + countUserSessions(dir), 0);
  if (sessions >= 3) return `chat_history:${sessions}`;
  return null;
}
