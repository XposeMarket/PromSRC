import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import type { DevSourceVerificationProfile } from './dev-source-approvals';

export type DevVerificationMode = 'verify_only' | 'apply_live';

export interface DevVerificationPlanInput {
  mode: DevVerificationMode;
  changedFiles?: unknown;
  changedSurfaces?: unknown;
  approvedProfiles?: unknown;
  requestedProfiles?: unknown;
  rootDir?: string;
}

export interface DevVerificationStep {
  id: 'syntax_changed' | DevSourceVerificationProfile;
  label: string;
  command?: string;
  timeoutMs?: number;
}

export interface DevVerificationStepResult {
  id: DevVerificationStep['id'];
  label: string;
  success: boolean;
  durationMs: number;
  command?: string;
  output?: string;
  skipped?: boolean;
}

export interface DevVerificationPlan {
  profileIds: DevSourceVerificationProfile[];
  source: 'requested' | 'approved' | 'auto';
  changedFiles: string[];
  surfaces: string[];
  steps: DevVerificationStep[];
}

export interface FreshBackendVerification {
  profileIds?: unknown;
  changedFiles?: unknown;
  success?: unknown;
  completedAt?: unknown;
}

const FRESH_BACKEND_VERIFICATION_MAX_AGE_MS = 10 * 60_000;

const PROFILE_IDS: DevSourceVerificationProfile[] = [
  'backend_build',
  'webui_sync_check',
  'full_build',
  'route_smoke',
  'desktop_ui_smoke',
  'mobile_ui_smoke',
  'none',
];

function normalizePath(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

export function normalizeDevVerificationProfiles(value: unknown): DevSourceVerificationProfile[] {
  const raw = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    raw
      .flatMap((item) => typeof item === 'string' && item.includes(',') ? item.split(',') : [item])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item): item is DevSourceVerificationProfile => PROFILE_IDS.includes(item as DevSourceVerificationProfile)),
  ));
}

export function normalizeDevChangedFiles(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(new Set(
    raw
      .map(normalizePath)
      .filter((file) => file.startsWith('src/') || file.startsWith('web-ui/')),
  ));
}

export function inferDevSurfacesFromFiles(files: string[]): string[] {
  const surfaces = new Set<string>();
  for (const file of files) {
    if (file.startsWith('src/')) surfaces.add('backend');
    if (file.startsWith('web-ui/src/mobile/')) surfaces.add('mobile');
    else if (file.startsWith('web-ui/')) surfaces.add('web-ui');
  }
  return Array.from(surfaces);
}

function normalizeSurfaces(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(new Set(
    raw
      .map((surface) => {
        const normalized = String(surface || '').trim().toLowerCase();
        if (normalized === 'src' || normalized === 'gateway') return 'backend';
        return normalized;
      })
      .filter(Boolean),
  ));
}

function inferProfiles(files: string[], surfaces: string[]): DevSourceVerificationProfile[] {
  const hasBackend = surfaces.includes('backend') || surfaces.includes('config');
  const hasMobile = surfaces.includes('mobile');
  const hasWeb = surfaces.includes('web-ui') || hasMobile || surfaces.includes('static');
  const profiles = new Set<DevSourceVerificationProfile>();

  if (hasWeb) profiles.add('webui_sync_check');
  if (hasBackend) profiles.add('backend_build');

  const touchesDesktopRoute = files.some((file) =>
    file === 'web-ui/src/pages/ChatPage.js'
    || file.includes('/pages/')
    || file.includes('/components/')
    || file === 'web-ui/src/App.js'
    || file === 'web-ui/src/main.js'
  );
  const touchesMobileRoute = files.some((file) => file.startsWith('web-ui/src/mobile/'));
  if (touchesDesktopRoute) profiles.add('desktop_ui_smoke');
  if (touchesMobileRoute) profiles.add('mobile_ui_smoke');

  if (hasBackend && (files.some((file) => file.includes('/routes/') || file.includes('/core/') || file.includes('/server')))) {
    profiles.add('route_smoke');
  }

  return Array.from(profiles);
}

export function resolveDevVerificationPlan(input: DevVerificationPlanInput): DevVerificationPlan {
  const changedFiles = normalizeDevChangedFiles(input.changedFiles);
  const surfaces = Array.from(new Set([
    ...normalizeSurfaces(input.changedSurfaces),
    ...inferDevSurfacesFromFiles(changedFiles),
  ]));
  const requested = normalizeDevVerificationProfiles(input.requestedProfiles);
  const approved = normalizeDevVerificationProfiles(input.approvedProfiles);
  const explicitProfiles = requested.length ? requested : approved;
  const profileIds = explicitProfiles.length ? explicitProfiles : inferProfiles(changedFiles, surfaces);
  const source = requested.length ? 'requested' : approved.length ? 'approved' : 'auto';
  const effectiveProfiles = profileIds.includes('none') ? ['none'] as DevSourceVerificationProfile[] : profileIds;

  const steps: DevVerificationStep[] = [];
  if (changedFiles.length) {
    steps.push({ id: 'syntax_changed', label: `syntax parse changed JS/TS (${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'})` });
  }
  if (!effectiveProfiles.includes('none')) {
    for (const profile of effectiveProfiles) {
      if (profile === 'webui_sync_check') {
        steps.push({ id: profile, label: 'web UI sync/check', command: 'npm run sync:web-ui', timeoutMs: 120_000 });
      } else if (profile === 'backend_build') {
        steps.push({ id: profile, label: 'backend build', command: 'npm run build:backend', timeoutMs: 180_000 });
      } else if (profile === 'full_build') {
        steps.push({ id: profile, label: 'full build', command: 'npm run build', timeoutMs: 240_000 });
      } else if (profile === 'route_smoke') {
        steps.push({ id: profile, label: 'route smoke' });
      } else if (profile === 'desktop_ui_smoke') {
        steps.push({ id: profile, label: 'desktop UI smoke' });
      } else if (profile === 'mobile_ui_smoke') {
        steps.push({ id: profile, label: 'mobile UI smoke' });
      }
    }
  }

  return { profileIds: effectiveProfiles, source, changedFiles, surfaces, steps };
}

/**
 * A dev gateway executes the TypeScript source directly, so a successful and
 * still-current verify_only backend build is sufficient to restart it.  The
 * apply coordinator independently verifies the content hashes before this is
 * consulted; this helper only guards against stale, partial, or unrelated
 * verification records.
 */
export function canReuseFreshBackendVerification(input: {
  verification?: FreshBackendVerification;
  backendFiles?: unknown;
  now?: number;
}): boolean {
  const verification = input.verification;
  if (!verification || verification.success !== true) return false;
  const completedAt = Number(verification.completedAt);
  const now = Number(input.now || Date.now());
  if (!Number.isFinite(completedAt) || now - completedAt < 0 || now - completedAt > FRESH_BACKEND_VERIFICATION_MAX_AGE_MS) {
    return false;
  }
  const profiles = normalizeDevVerificationProfiles(verification.profileIds);
  if (!profiles.includes('backend_build') && !profiles.includes('full_build')) return false;

  const requiredFiles = normalizeDevChangedFiles(input.backendFiles).filter((file) => file.startsWith('src/'));
  const verifiedFiles = new Set(normalizeDevChangedFiles(verification.changedFiles));
  return requiredFiles.length > 0 && requiredFiles.every((file) => verifiedFiles.has(file));
}

function syntaxKindForPath(file: string, ts: typeof import('typescript')): import('typescript').ScriptKind {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseChangedSyntax(rootDir: string, files: string[]): string | null {
  const candidates = files.filter((file) => ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(path.extname(file).toLowerCase()));
  if (!candidates.length) return null;
  try {
    const ts = require('typescript') as typeof import('typescript');
    const errors: string[] = [];
    for (const rel of candidates) {
      const abs = path.resolve(rootDir, rel);
      if (!abs.startsWith(rootDir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const content = fs.readFileSync(abs, 'utf-8');
      const sf = ts.createSourceFile(abs, content, ts.ScriptTarget.Latest, true, syntaxKindForPath(rel, ts));
      const diagnostics = (sf as any).parseDiagnostics || [];
      for (const diag of diagnostics.slice(0, 3)) {
        const pos = typeof diag.start === 'number' ? sf.getLineAndCharacterOfPosition(diag.start) : { line: 0, character: 0 };
        const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
        errors.push(`${rel}:${pos.line + 1}:${pos.character + 1} TS${diag.code}: ${message}`);
      }
    }
    return errors.length ? errors.slice(0, 8).join('\n') : null;
  } catch {
    return null;
  }
}

function runCommandStep(rootDir: string, step: DevVerificationStep): Promise<DevVerificationStepResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(step.command || '', {
      cwd: rootDir,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    let timer: NodeJS.Timeout;
    const append = (chunk: any) => { output = `${output}${String(chunk || '')}`.slice(-16_000); };
    const finish = (success: boolean, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extra) append(`\n${extra}`);
      resolve({ id: step.id, label: step.label, command: step.command, success, durationMs: Date.now() - start, output: output.slice(-2500) });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (err) => finish(false, err.message));
    child.once('exit', (code, signal) => finish(code === 0, code === 0 ? '' : `Command exited with ${signal || code}.`));
    const timeoutMs = step.timeoutMs || 120_000;
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(false, `Command timed out after ${timeoutMs}ms.`);
    }, timeoutMs);
    timer.unref?.();
  });
}

function getGatewayBaseUrl(): string {
  const cfg = getConfig().getConfig() as any;
  const port = Number(cfg?.gateway?.port) || 18789;
  const configuredHost = String(cfg?.gateway?.host || '127.0.0.1');
  const host = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;
  return `http://${host}:${port}`;
}

async function runRouteSmoke(step: DevVerificationStep): Promise<DevVerificationStepResult> {
  const start = Date.now();
  const baseUrl = getGatewayBaseUrl();
  const checks = ['/api/health'];
  const lines: string[] = [];
  try {
    for (const route of checks) {
      const resp = await fetch(`${baseUrl}${route}`);
      lines.push(`${route}: ${resp.status}`);
      if (!resp.ok) {
        return { id: step.id, label: step.label, success: false, durationMs: Date.now() - start, output: lines.join('\n') };
      }
    }
    lines.push('/api/status and /api/mobile/chat/runs require local auth; skipped until authenticated smoke context is available.');
    return { id: step.id, label: step.label, success: true, durationMs: Date.now() - start, output: lines.join('\n') };
  } catch (err: any) {
    return { id: step.id, label: step.label, success: false, durationMs: Date.now() - start, output: err?.message || String(err) };
  }
}

async function runUiSmoke(step: DevVerificationStep, route: string): Promise<DevVerificationStepResult> {
  const start = Date.now();
  const baseUrl = getGatewayBaseUrl();
  let browser: any;
  try {
    const { chromium } = require('playwright') as typeof import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: any) => {
      if (msg.type && msg.type() === 'error') consoleErrors.push(String(msg.text ? msg.text() : msg));
    });
    page.on('pageerror', (err: any) => pageErrors.push(err?.message || String(err)));
    const resp = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForSelector('body', { timeout: 5_000 });
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    await browser.close();
    const fatalErrors = [...pageErrors, ...consoleErrors].filter((line) => !/favicon|ResizeObserver loop/i.test(line));
    const output = [
      `${route}: ${resp?.status() || 'loaded'}`,
      `body_chars: ${bodyText.length}`,
      `fatal_console_errors: ${fatalErrors.length}`,
      ...fatalErrors.slice(0, 5),
    ].join('\n');
    return { id: step.id, label: step.label, success: fatalErrors.length === 0, durationMs: Date.now() - start, output };
  } catch (err: any) {
    try { if (browser) await browser.close(); } catch {}
    return { id: step.id, label: step.label, success: false, durationMs: Date.now() - start, output: err?.message || String(err) };
  }
}

export async function runDevVerificationPlan(plan: DevVerificationPlan, rootDir: string): Promise<DevVerificationStepResult[]> {
  const results: DevVerificationStepResult[] = [];
  for (const step of plan.steps) {
    if (step.id === 'syntax_changed') {
      const start = Date.now();
      const syntaxError = parseChangedSyntax(rootDir, plan.changedFiles);
      results.push({
        id: step.id,
        label: step.label,
        success: !syntaxError,
        durationMs: Date.now() - start,
        output: syntaxError || 'ok',
      });
    } else if (step.command) {
      results.push(await runCommandStep(rootDir, step));
    } else if (step.id === 'route_smoke') {
      results.push(await runRouteSmoke(step));
    } else if (step.id === 'desktop_ui_smoke') {
      results.push(await runUiSmoke(step, '/'));
    } else if (step.id === 'mobile_ui_smoke') {
      results.push(await runUiSmoke(step, '/mobile'));
    }
    if (results[results.length - 1]?.success === false) break;
  }
  return results;
}

export function formatDevVerificationSummary(plan: DevVerificationPlan, results: DevVerificationStepResult[]): string {
  const lines = [
    `Profile: ${plan.profileIds.join(' + ') || 'auto-none'} (${plan.source}${plan.changedFiles.length ? ` from ${plan.changedFiles.length} changed file${plan.changedFiles.length === 1 ? '' : 's'}` : ''})`,
    'Checks:',
    ...results.map((result) => {
      const command = result.command ? `${result.command}: ` : '';
      const status = result.success ? 'ok' : 'failed';
      return `- ${command}${status} (${result.durationMs}ms)`;
    }),
  ];
  return lines.join('\n');
}
