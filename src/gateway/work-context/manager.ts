import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getConfig } from '../../config/config';
import { getBrowserAdvisorPacket, getBrowserSessionInfo } from '../browser-tools';
import { getCodingWorkspaceSession } from '../coding/workspace-session';
import { getDesktopAdvisorPacket } from '../desktop-tools';
import { getCanvasProjectLabel, getCanvasProjectRoot, getCreativeMode } from '../session';
import type {
  PreparedWorkContext,
  WorkContextArtifact,
  WorkContextConfig,
  WorkContextDomain,
  WorkContextPacket,
  WorkContextTarget,
} from './contracts';
import { deleteWorkContextPacket, listWorkContextPackets, loadWorkContextPacket, saveWorkContextPacket } from './store';

const CODING_PATH_RE = /\.(?:[cm]?[jt]sx?|cpp|cc|cxx|c|h|hpp|py|rs|go|java|kt|swift|cs|php|rb|vue|svelte|html|css|scss|json|ya?ml|toml|cmake)$/i;
const HIGH_IMPACT_RE = /\b(?:submit|send|publish|purchase|buy|checkout|delete|remove account|pay|transfer|post)\b/i;

function hashText(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprintObjective(value: string): string {
  return hashText(String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()).slice(0, 20);
}

function fileFingerprint(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    if (stat.size <= 12 * 1024 * 1024) return hashText(fs.readFileSync(filePath));
    return hashText(`${stat.size}:${stat.mtimeMs}`);
  } catch {
    return undefined;
  }
}

function gitValue(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gitDirty(root: string): string[] {
  const value = gitValue(root, ['status', '--porcelain=v1']);
  return value ? value.split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 80) : [];
}

function resolveConfig(): WorkContextConfig {
  const raw = (getConfig().getConfig() as any)?.work_context || {};
  const fast = raw.fast_paths || raw.fastPaths || {};
  return {
    enabled: raw.enabled !== false,
    shadowMode: raw.shadow_mode !== false,
    maxPacketBytes: Math.max(24_000, Math.min(512_000, Number(raw.max_packet_bytes) || 96_000)),
    maxAgeHours: Math.max(1, Math.min(24 * 365, Number(raw.max_age_hours) || 24 * 14)),
    fastPaths: {
      coding: fast.coding === true,
      browser: fast.browser === true,
      desktop: fast.desktop === true,
      creative: fast.creative === true,
      generic: fast.generic === true,
    },
  };
}

function inferDomain(message: string, packet?: WorkContextPacket | null): WorkContextDomain {
  const text = String(message || '').toLowerCase();
  if (/\b(browser|website|web page|tab|click|scroll|form|url|chrome)\b/.test(text)) return 'browser';
  if (/\b(desktop|window|app|application|screen|dialog|menu|mouse|keyboard)\b/.test(text)) return 'desktop';
  if (/\b(video|creative|canvas|scene|timeline|render|animation|caption|image|layer|shot|export)\b/.test(text)) return 'creative';
  if (/\b(code|source|file|function|class|build|compile|test|bug|fix|repo|project|typescript|javascript|python|cmake|vita)\b/.test(text)) return 'coding';
  return packet?.activeDomain || 'generic';
}

function isContinuation(message: string, packet: WorkContextPacket | null, domain: WorkContextDomain): boolean {
  if (!packet || packet.status !== 'active') return false;
  const text = String(message || '').toLowerCase();
  if (/^(?:ok(?:ay)?|alright|yeah|yes|continue|go ahead|do it|now|also|and|make it|change it|try|rerun|rebuild|render it)\b/.test(text.trim())) return true;
  if (domain !== packet.activeDomain) return false;
  const targetLabels = [
    ...(packet.coding?.targets || []).flatMap((target) => [target.path ? path.basename(target.path).toLowerCase() : '', target.symbol?.toLowerCase() || '']),
    ...(packet.browser?.namedTargets || []).map((target) => String(target.name || '').toLowerCase()),
    ...(packet.desktop?.semanticTargets || []).map((target) => String(target.name || '').toLowerCase()),
    packet.creative?.sceneId?.toLowerCase() || '',
    packet.creative?.compositionId?.toLowerCase() || '',
  ].filter((label) => label.length >= 3);
  if (targetLabels.some((label) => text.includes(label))) return true;
  const stop = new Set(['this', 'that', 'with', 'from', 'into', 'then', 'make', 'change', 'please', 'code', 'file', 'build', 'test', 'browser', 'desktop', 'creative', 'video', 'image', 'project']);
  const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9_]{4,}/g)?.filter((token) => !stop.has(token)) || []);
  const currentTokens = tokens(text);
  const objectiveTokens = tokens(packet.objective);
  let overlap = 0;
  for (const token of currentTokens) if (objectiveTokens.has(token)) overlap += 1;
  if (overlap >= 2 || (overlap >= 1 && currentTokens.size <= 5)) return true;
  return false;
}

function createPacket(sessionId: string, message: string, domain: WorkContextDomain): WorkContextPacket {
  const now = Date.now();
  return {
    version: 1,
    id: `work_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    sessionId,
    revision: 0,
    status: 'active',
    activeDomain: domain,
    objective: String(message || '').trim().slice(0, 2000),
    objectiveFingerprint: fingerprintObjective(message),
    createdAt: now,
    updatedAt: now,
    lastUserMessage: String(message || '').trim().slice(0, 2000),
    freshness: 'unknown',
    completedSteps: [],
    pendingSteps: [],
    evidenceRefs: [],
    artifacts: [],
    metrics: {
      startedAt: now,
      totalToolCalls: 0,
      discoveryToolCalls: 0,
      mutationToolCalls: 0,
      verificationToolCalls: 0,
      accumulatedToolMs: 0,
    },
    generic: { relevantPaths: [], decisions: [], updatedAt: now },
  };
}

function upsertTarget(targets: WorkContextTarget[], next: WorkContextTarget): WorkContextTarget[] {
  const key = `${next.kind}:${next.path || ''}:${next.symbol || next.name || ''}`;
  const filtered = targets.filter((target) => `${target.kind}:${target.path || ''}:${target.symbol || target.name || ''}` !== key);
  return [...filtered, next].slice(-40);
}

function addArtifact(packet: WorkContextPacket, artifact: WorkContextArtifact): void {
  const key = `${artifact.kind}:${artifact.path || artifact.url || artifact.id || ''}`;
  packet.artifacts = [...packet.artifacts.filter((item) => `${item.kind}:${item.path || item.url || item.id || ''}` !== key), artifact].slice(-32);
}

function candidatePaths(args: any, data: any, extra: any): string[] {
  const out = new Set<string>();
  const visit = (value: any, depth = 0): void => {
    if (value == null || depth > 4) return;
    if (Array.isArray(value)) {
      value.slice(0, 40).forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (/^(?:path|file|filename|cwd|workdir|output|outputPath|outputRelPath|artifactPath|destination|htmlPath|previewPath|compositionPath)$/i.test(key) && typeof inner === 'string') out.add(inner);
      visit(inner, depth + 1);
    }
  };
  visit(args); visit(data); visit(extra);
  return [...out].slice(0, 40);
}

function resolveMaybePath(value: string, workspacePath: string, cwd?: string): string {
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(cwd || workspacePath, value);
}

async function refreshCoding(packet: WorkContextPacket, workspacePath: string): Promise<void> {
  if (!packet.coding) return;
  const root = packet.coding.root || workspacePath;
  packet.coding.branch = gitValue(root, ['branch', '--show-current']) || packet.coding.branch;
  packet.coding.head = gitValue(root, ['rev-parse', 'HEAD']) || packet.coding.head;
  packet.coding.dirtyFilesNow = gitDirty(root);
  let stale = false;
  let relocated = false;
  packet.coding.targets = packet.coding.targets.map((target) => {
    if (!target.path || target.kind !== 'file') return target;
    const absPath = resolveMaybePath(target.path, workspacePath, root);
    const current = fileFingerprint(absPath);
    if (!current) return { ...target, freshness: 'stale' as const, updatedAt: Date.now() };
    if (target.hash && current !== target.hash) {
      let anchorsStillMatch = false;
      if (target.anchors?.length) {
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          anchorsStillMatch = target.anchors.every((anchor) => content.includes(anchor));
        } catch {
          anchorsStillMatch = false;
        }
      }
      if (anchorsStillMatch) relocated = true;
      else stale = true;
      return { ...target, hash: current, freshness: anchorsStillMatch ? 'relocated' as const : 'stale' as const, updatedAt: Date.now() };
    }
    return { ...target, hash: current, freshness: 'fresh' as const, updatedAt: Date.now() };
  });
  packet.freshness = stale ? 'stale' : relocated ? 'relocated' : 'fresh';
}

async function refreshBrowser(packet: WorkContextPacket): Promise<void> {
  const info = getBrowserSessionInfo(packet.sessionId);
  if (!info.active) {
    if (packet.browser) packet.freshness = 'stale';
    return;
  }
  const advisor = await getBrowserAdvisorPacket(packet.sessionId, { maxItems: 0, snapshotElements: 24 }).catch(() => null);
  const previousHash = packet.browser?.contentHash;
  packet.browser = {
    browserSessionId: info.sessionId,
    profileKind: info.profileKind,
    profileLabel: info.profileLabel,
    url: advisor?.page.url || info.url,
    title: advisor?.page.title || info.title,
    pageType: advisor?.page.pageType,
    contentHash: advisor?.contentHash,
    controlOwner: info.controlOwner,
    namedTargets: packet.browser?.namedTargets || [],
    pendingCommitBoundary: packet.browser?.pendingCommitBoundary,
    updatedAt: Date.now(),
  };
  packet.freshness = previousHash && advisor?.contentHash && previousHash !== advisor.contentHash ? 'relocated' : 'fresh';
}

function refreshDesktop(packet: WorkContextPacket): void {
  const advisor = getDesktopAdvisorPacket(packet.sessionId);
  if (!advisor) {
    if (packet.desktop) packet.freshness = 'stale';
    return;
  }
  const previousHash = packet.desktop?.contentHash;
  packet.desktop = {
    activeWindowHandle: advisor.activeWindow?.handle,
    activeWindowTitle: advisor.activeWindow?.title,
    activeWindowProcessName: advisor.activeWindow?.processName,
    activeMonitorIndex: advisor.activeMonitorIndex ?? undefined,
    screenshotId: advisor.screenshotId,
    contentHash: advisor.contentHash,
    semanticTargets: packet.desktop?.semanticTargets || [],
    pendingCommitBoundary: packet.desktop?.pendingCommitBoundary,
    updatedAt: Date.now(),
  };
  packet.freshness = previousHash && previousHash !== advisor.contentHash ? 'relocated' : 'fresh';
}

function refreshCreative(packet: WorkContextPacket): void {
  const projectRoot = getCanvasProjectRoot(packet.sessionId);
  packet.creative = {
    ...(packet.creative || { activeLayers: [], sourceAssets: [], updatedAt: Date.now() }),
    mode: getCreativeMode(packet.sessionId) || packet.creative?.mode,
    projectRoot: projectRoot || packet.creative?.projectRoot,
    projectLabel: getCanvasProjectLabel(packet.sessionId) || packet.creative?.projectLabel,
    updatedAt: Date.now(),
  };
  packet.freshness = projectRoot && fs.existsSync(projectRoot) ? 'fresh' : packet.creative?.sceneId ? 'unknown' : 'stale';
}

async function refreshPacket(packet: WorkContextPacket, workspacePath: string): Promise<void> {
  if (packet.activeDomain === 'coding') await refreshCoding(packet, workspacePath);
  else if (packet.activeDomain === 'browser') await refreshBrowser(packet);
  else if (packet.activeDomain === 'desktop') refreshDesktop(packet);
  else if (packet.activeDomain === 'creative') refreshCreative(packet);
}

function formatTargets(targets: WorkContextTarget[], limit = 8): string[] {
  return targets.slice(-limit).map((target) => {
    const label = target.path || target.symbol || target.name || target.kind;
    const anchors = target.anchors?.length ? ` anchors=${target.anchors.slice(0, 3).join(' | ')}` : '';
    const hash = target.hash ? ` hash=${target.hash.slice(0, 12)}` : '';
    return `- ${label} freshness=${target.freshness}${hash}${anchors}`;
  });
}

export function formatWorkContextBlock(packet: WorkContextPacket): string {
  const lines = [
    '[WORK_CONTEXT]',
    `id=${packet.id} revision=${packet.revision} domain=${packet.activeDomain} freshness=${packet.freshness}`,
    `objective=${packet.objective.replace(/\s+/g, ' ').slice(0, 500)}`,
  ];
  if (packet.nextSafeAction) lines.push(`next_safe_action=${packet.nextSafeAction.slice(0, 400)}`);
  const recent = packet.completedSteps.slice(-5);
  if (recent.length) {
    lines.push('recent_completed:');
    for (const step of recent) lines.push(`- ${step.summary.slice(0, 260)}`);
  }
  if (packet.coding) {
    lines.push(`coding_root=${packet.coding.root || ''}`);
    if (packet.coding.branch) lines.push(`branch=${packet.coding.branch}`);
    if (packet.coding.buildDirectory) lines.push(`build_directory=${packet.coding.buildDirectory}`);
    if (packet.coding.buildCommand) lines.push(`known_build=${packet.coding.buildCommand}`);
    if (packet.coding.testCommand) lines.push(`known_test=${packet.coding.testCommand}`);
    if (packet.coding.dirtyFilesBefore.length) lines.push(`dirty_before=${packet.coding.dirtyFilesBefore.slice(0, 12).join(', ')}`);
    if (packet.coding.targets.length) lines.push('coding_targets:', ...formatTargets(packet.coding.targets));
  }
  if (packet.browser) {
    lines.push(`browser=${packet.browser.title || ''} ${packet.browser.url || ''}`.trim());
    if (packet.browser.contentHash) lines.push(`browser_hash=${packet.browser.contentHash.slice(0, 16)}`);
    if (packet.browser.pendingCommitBoundary) lines.push(`browser_commit_boundary=${packet.browser.pendingCommitBoundary}`);
  }
  if (packet.desktop) {
    lines.push(`desktop_window=${packet.desktop.activeWindowProcessName || ''}:${packet.desktop.activeWindowTitle || ''} handle=${packet.desktop.activeWindowHandle || ''}`);
    if (packet.desktop.screenshotId) lines.push(`desktop_screenshot=${packet.desktop.screenshotId} hash=${String(packet.desktop.contentHash || '').slice(0, 16)}`);
    if (packet.desktop.pendingCommitBoundary) lines.push(`desktop_commit_boundary=${packet.desktop.pendingCommitBoundary}`);
  }
  if (packet.creative) {
    lines.push(`creative_mode=${packet.creative.mode || ''} project=${packet.creative.projectRoot || ''}`);
    if (packet.creative.sceneId) lines.push(`scene=${packet.creative.sceneId} version=${packet.creative.sceneVersion || ''} hash=${String(packet.creative.sceneHash || '').slice(0, 16)}`);
    if (packet.creative.compositionId) lines.push(`composition=${packet.creative.compositionId}`);
  }
  if (packet.artifacts.length) {
    lines.push('artifacts:');
    for (const artifact of packet.artifacts.slice(-8)) lines.push(`- ${artifact.kind}: ${artifact.path || artifact.url || artifact.id || ''}${artifact.hash ? ` hash=${artifact.hash.slice(0, 12)}` : ''}`);
  }
  lines.push('Use this packet as a freshness-checked working set. Do not rediscover known state unless a guard is stale or ambiguous. Fast paths may bundle predictable low-risk steps, but never bypass approval or irreversible-action boundaries.');
  return lines.join('\n').slice(0, 9000);
}

export async function prepareWorkContextForTurn(sessionId: string, message: string, workspacePath: string): Promise<PreparedWorkContext> {
  const config = resolveConfig();
  const previous = config.enabled ? loadWorkContextPacket(sessionId) : null;
  if (previous && Date.now() - previous.updatedAt > config.maxAgeHours * 60 * 60 * 1000) previous.freshness = 'stale';
  const domain = inferDomain(message, previous);
  const continuation = isContinuation(message, previous, domain);
  let packet = previous;
  if (!config.enabled) return { packet: null, block: '', domain, continuation: false, fastPathEligible: false, reason: 'work context disabled' };
  if (!packet || !continuation) packet = createPacket(sessionId, message, domain);
  const turnStartedAt = Date.now();
  packet.metrics = {
    startedAt: turnStartedAt,
    totalToolCalls: 0,
    discoveryToolCalls: 0,
    mutationToolCalls: 0,
    verificationToolCalls: 0,
    accumulatedToolMs: 0,
  };
  packet.activeDomain = domain;
  packet.lastUserMessage = String(message || '').trim().slice(0, 2000);
  if (!continuation) {
    packet.objective = String(message || '').trim().slice(0, 2000);
    packet.objectiveFingerprint = fingerprintObjective(message);
  }
  if (HIGH_IMPACT_RE.test(message)) {
    const boundary = 'High-impact action detected; stop before final submit/send/publish/purchase/delete and use normal approval policy.';
    if (domain === 'browser') packet.browser = { ...(packet.browser || { namedTargets: [], updatedAt: Date.now() }), pendingCommitBoundary: boundary, updatedAt: Date.now() };
    if (domain === 'desktop') packet.desktop = { ...(packet.desktop || { semanticTargets: [], updatedAt: Date.now() }), pendingCommitBoundary: boundary, updatedAt: Date.now() };
  }
  if (domain === 'coding' && !packet.coding) {
    try {
      const coding = getCodingWorkspaceSession(workspacePath);
      packet.coding = {
        root: coding.root,
        branch: coding.branch,
        head: gitValue(coding.root, ['rev-parse', 'HEAD']) || undefined,
        packageManager: coding.packageManager,
        dirtyFilesBefore: coding.dirtyFiles.slice(0, 80),
        dirtyFilesNow: coding.dirtyFiles.slice(0, 80),
        targets: [],
        buildCommand: coding.buildCommand,
        testCommand: coding.testCommand,
        devCommand: coding.devCommand,
      };
    } catch {
      packet.coding = { root: workspacePath, dirtyFilesBefore: [], dirtyFilesNow: [], targets: [] };
    }
  }
  await refreshPacket(packet, workspacePath);
  packet = saveWorkContextPacket(packet, config.maxPacketBytes);
  const domainEnabled = config.fastPaths[domain];
  const freshEnough = packet.freshness === 'fresh' || packet.freshness === 'relocated' || packet.freshness === 'unknown';
  const fastPathEligible = continuation && domainEnabled && freshEnough && !config.shadowMode;
  const reason = config.shadowMode
    ? 'shadow mode records context but does not alter execution'
    : !continuation
      ? 'new or unrelated work needs normal discovery'
      : !domainEnabled
        ? `${domain} fast path disabled`
        : !freshEnough
          ? 'stored state is stale'
          : 'warm, bounded continuation with usable state';
  return { packet, block: formatWorkContextBlock(packet), domain, continuation, fastPathEligible, reason };
}

export async function observeWorkContextToolResult(input: {
  sessionId: string;
  workspacePath: string;
  userMessage: string;
  toolName: string;
  args?: any;
  result?: string;
  error?: boolean;
  data?: any;
  extra?: any;
  artifacts?: any[];
}): Promise<WorkContextPacket | null> {
  const config = resolveConfig();
  if (!config.enabled) return null;
  let packet = loadWorkContextPacket(input.sessionId) || createPacket(input.sessionId, input.userMessage, inferDomain(input.userMessage));
  const now = Date.now();
  const toolName = String(input.toolName || 'unknown');
  packet.generic.lastTool = toolName;
  packet.generic.updatedAt = now;
  packet.metrics.totalToolCalls += 1;
  const discoveryTool = /(?:read|grep|search|stats|snapshot|state|list|get_|observe|inspect)/i.test(toolName);
  const mutationTool = /(?:edit|patch|replace|insert|delete|write|create|click|fill|type|press|scene|image_ops|video_ops|hyperframes_ops)/i.test(toolName);
  const verificationTool = /(?:validate|build|test|lint|check|render_snapshot|quality)/i.test(toolName)
    || /\b(?:build|test|lint|check|cmake)\b/i.test(String(input.args?.command || ''));
  if (discoveryTool) packet.metrics.discoveryToolCalls += 1;
  if (mutationTool) {
    packet.metrics.mutationToolCalls += 1;
    packet.metrics.firstMutationAt ||= now;
  }
  if (verificationTool) packet.metrics.verificationToolCalls += 1;
  const observedDuration = Number(
    input.extra?.telemetry?.durationMs
    ?? input.extra?.durationMs
    ?? input.data?.telemetry?.durationMs
    ?? input.data?.durationMs
    ?? input.data?.elapsedMs
    ?? input.data?.elapsed_ms,
  );
  if (Number.isFinite(observedDuration) && observedDuration > 0) packet.metrics.accumulatedToolMs += observedDuration;
  const summaryText = String(input.result || '').replace(/\s+/g, ' ').trim();
  packet.completedSteps.push({
    summary: `${toolName}${input.error ? ' failed' : ' completed'}${summaryText ? `: ${summaryText.slice(0, 220)}` : ''}`,
    status: input.error ? 'failed' : 'completed',
    toolName,
    updatedAt: now,
  });
  packet.completedSteps = packet.completedSteps.slice(-24);
  const paths = candidatePaths(input.args, input.data, input.extra);
  if (paths.length) packet.metrics.firstTargetAt ||= now;
  packet.generic.relevantPaths = Array.from(new Set([...packet.generic.relevantPaths, ...paths])).slice(-40);
  const cwdRaw = String(input.args?.cwd || input.args?.workdir || input.workspacePath || '').trim();
  const cwd = cwdRaw ? resolveMaybePath(cwdRaw, input.workspacePath) : input.workspacePath;
  for (const candidate of paths) {
    const absPath = resolveMaybePath(candidate, input.workspacePath, cwd);
    try {
      const stat = fs.statSync(absPath);
      if (stat.isFile() && /\.(?:vpk|mp4|mov|webm|gif|png|jpe?g|webp|pdf|zip|tar|gz|exe|msi|apk|ipa|wasm)$/i.test(absPath)) {
        addArtifact(packet, { kind: path.extname(absPath).slice(1).toLowerCase() || 'file', path: absPath, hash: fileFingerprint(absPath), bytes: stat.size, updatedAt: now });
      }
    } catch {
      // Candidate paths are best-effort observations; missing paths are not artifacts.
    }
  }

  const codingRelated = /(?:workspace_(?:read|edit|run)|read_file|grep_|search_files|file_stats|apply_.*patch|find_replace|replace_lines|validate|run_command|terminal|shell)/i.test(toolName)
    || paths.some((candidate) => CODING_PATH_RE.test(candidate));
  if (codingRelated) {
    packet.activeDomain = packet.activeDomain === 'generic' ? 'coding' : packet.activeDomain;
    packet.coding ||= {
      root: cwd,
      branch: gitValue(cwd, ['branch', '--show-current']) || undefined,
      head: gitValue(cwd, ['rev-parse', 'HEAD']) || undefined,
      dirtyFilesBefore: gitDirty(cwd),
      dirtyFilesNow: gitDirty(cwd),
      targets: [],
    };
    if (!packet.coding.root || input.args?.cwd || input.args?.workdir) packet.coding.root = cwd;
    for (const candidate of paths.filter((item) => CODING_PATH_RE.test(item))) {
      const absPath = resolveMaybePath(candidate, input.workspacePath, cwd);
      const hash = fileFingerprint(absPath);
      const anchors = [input.args?.anchor, input.args?.find, input.args?.expected_before]
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 180))
        .slice(0, 3);
      packet.coding.targets = upsertTarget(packet.coding.targets, {
        kind: 'file',
        path: absPath,
        anchors,
        lineHints: [input.args?.start_line, input.args?.end_line, input.args?.after_line].map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 4),
        hash,
        freshness: hash ? 'fresh' : 'stale',
        updatedAt: now,
      });
    }
    const command = String(input.args?.command || '').trim();
    if (command) {
      if (!input.error && /\b(?:cmake\s+--build|npm\s+run\s+build|pnpm\s+build|yarn\s+build|cargo\s+build|dotnet\s+build|go\s+build)\b/i.test(command)) {
        packet.coding.buildCommand = command;
        const buildDirMatch = command.match(/(?:--build\s+|\s-B\s*)([^\s"']+)/i);
        if (buildDirMatch) packet.coding.buildDirectory = buildDirMatch[1];
      }
      if (!input.error && /\b(?:test|pytest|vitest|jest|cargo\s+test|dotnet\s+test|go\s+test)\b/i.test(command)) packet.coding.testCommand = command;
      if (/\b(?:build|test|lint|check|cmake)\b/i.test(command)) {
        packet.coding.lastCheck = { command, exitCode: Number(input.extra?.exitCode ?? input.data?.exitCode ?? (input.error ? 1 : 0)), passed: !input.error, summary: summaryText.slice(0, 500), updatedAt: now };
      }
    }
    packet.coding.dirtyFilesNow = gitDirty(packet.coding.root || cwd);
  }

  if (toolName.startsWith('browser_')) {
    packet.activeDomain = 'browser';
    await refreshBrowser(packet);
    const targetName = String(input.args?.element_name || input.args?.element || input.args?.selector || '').trim();
    if (targetName && packet.browser) packet.browser.namedTargets = upsertTarget(packet.browser.namedTargets, { kind: 'element', name: targetName, freshness: 'fresh', updatedAt: now });
  }
  if (toolName.startsWith('desktop_')) {
    packet.activeDomain = 'desktop';
    refreshDesktop(packet);
    const targetName = String(input.args?.element_name || input.args?.automation_id || input.args?.window_title || '').trim();
    if (targetName && packet.desktop) packet.desktop.semanticTargets = upsertTarget(packet.desktop.semanticTargets, { kind: 'element', name: targetName, freshness: 'fresh', updatedAt: now });
  }
  if (/^(?:creative_|canvas_|video_|hyperframes_)/.test(toolName)) {
    packet.activeDomain = 'creative';
    refreshCreative(packet);
    const state = input.data?.sceneSummary || input.data?.summary || input.extra?.sceneSummary || {};
    if (packet.creative) {
      packet.creative.sceneId = String(state.id || state.sceneId || packet.creative.sceneId || '') || undefined;
      packet.creative.sceneVersion = Number(state.version || packet.creative.sceneVersion) || undefined;
      packet.creative.sceneHash = String(state.contentHash || state.hash || packet.creative.sceneHash || '') || undefined;
      packet.creative.compositionId = String(input.data?.compositionId || state.compositionId || packet.creative.compositionId || '') || undefined;
      packet.creative.width = Number(state.width || packet.creative.width) || undefined;
      packet.creative.height = Number(state.height || packet.creative.height) || undefined;
      packet.creative.durationMs = Number(state.durationMs || packet.creative.durationMs) || undefined;
    }
  }

  for (const raw of Array.isArray(input.artifacts) ? input.artifacts : []) {
    const artifact: WorkContextArtifact = {
      kind: String(raw?.kind || raw?.type || 'artifact'),
      path: raw?.path ? String(raw.path) : undefined,
      url: raw?.url ? String(raw.url) : undefined,
      id: raw?.id ? String(raw.id) : undefined,
      hash: raw?.hash || raw?.sha256 ? String(raw.hash || raw.sha256) : undefined,
      bytes: Number.isFinite(Number(raw?.bytes)) ? Number(raw.bytes) : undefined,
      updatedAt: now,
    };
    addArtifact(packet, artifact);
  }
  packet.freshness = input.error ? packet.freshness : (packet.freshness === 'stale' ? 'stale' : 'fresh');
  if (verificationTool && !input.error && packet.metrics.firstMutationAt) {
    packet.metrics.verifiedAt = now;
    packet.metrics.requestToVerifiedMs = Math.max(0, now - packet.metrics.startedAt);
  }
  if (packet.metrics.requestToVerifiedMs != null) {
    packet.metrics.estimatedNonToolMs = Math.max(0, packet.metrics.requestToVerifiedMs - packet.metrics.accumulatedToolMs);
  }
  packet.nextSafeAction = input.error ? `Inspect the focused ${packet.activeDomain} failure before retrying.` : `Continue the ${packet.activeDomain} workflow from the verified current state.`;
  return saveWorkContextPacket(packet, config.maxPacketBytes);
}

export function getWorkContextConfig(): WorkContextConfig {
  return resolveConfig();
}

export function getWorkContextPacket(sessionId: string): WorkContextPacket | null {
  return loadWorkContextPacket(sessionId);
}

export function clearWorkContext(sessionId: string): void {
  deleteWorkContextPacket(sessionId);
}

export function getWorkContextBenchmarkSummary(): Record<string, any> {
  const samples = listWorkContextPackets().filter((packet) => Number.isFinite(packet.metrics?.requestToVerifiedMs));
  const percentile = (values: number[], p: number): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
  };
  const durations = samples.map((packet) => Number(packet.metrics.requestToVerifiedMs));
  const toolDurations = samples.map((packet) => Number(packet.metrics.accumulatedToolMs || 0));
  const nonToolDurations = samples.map((packet) => Number(packet.metrics.estimatedNonToolMs || 0));
  return {
    metric: 'time_from_user_request_to_successful_verification_after_mutation',
    sampleCount: samples.length,
    requestToVerifiedMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: durations.length ? Math.max(...durations) : null },
    observedToolMs: { p50: percentile(toolDurations, 0.5), p95: percentile(toolDurations, 0.95) },
    estimatedDecisionAndWorkflowMs: { p50: percentile(nonToolDurations, 0.5), p95: percentile(nonToolDurations, 0.95) },
    samples: samples.slice(0, 100).map((packet) => ({
      sessionId: packet.sessionId,
      packetId: packet.id,
      domain: packet.activeDomain,
      objective: packet.objective.slice(0, 240),
      ...packet.metrics,
    })),
  };
}
