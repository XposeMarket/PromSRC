import type { WorkContextDomain, WorkContextPacket } from './contracts';
import { getWorkContextConfig, getWorkContextPacket } from './manager';

export interface WorkContextFastPathStep {
  tool: string;
  args?: Record<string, any>;
}

export interface WorkContextFastPathArgs {
  domain: WorkContextDomain;
  expected_context_revision: number;
  expected_content_hash?: string;
  expected_url?: string;
  expected_window_handle?: string;
  expected_scene_version?: number;
  steps: WorkContextFastPathStep[];
}

export interface WorkContextFastPathPreflight {
  ok: boolean;
  packet: WorkContextPacket | null;
  steps: WorkContextFastPathStep[];
  error?: string;
}

const CODING_TOOLS = new Set([
  'workspace_read', 'read_file', 'read_files_batch', 'grep_file', 'grep_files', 'search_files', 'file_stats',
  'source_stats', 'source_stats_batch', 'read_source', 'grep_source', 'read_webui_source', 'grep_webui_source',
  'validate_file', 'validate_source', 'validate_webui_source', 'workspace_edit', 'apply_workspace_patchset',
  'apply_dev_source_patchset', 'workspace_run', 'run_command', 'terminal',
]);

const BROWSER_TOOLS = new Set([
  'browser_snapshot', 'browser_snapshot_delta', 'browser_get_page_text', 'browser_get_url',
  'browser_scroll', 'browser_wait', 'browser_open', 'browser_back', 'browser_forward',
]);

const DESKTOP_TOOLS = new Set([
  'desktop_screenshot', 'desktop_list_windows', 'desktop_get_active_window', 'desktop_focus_window',
  'desktop_wait', 'desktop_wait_for_change', 'desktop_diff_screenshot',
]);

const CREATIVE_TOOLS = new Set([
  'creative_get_state', 'creative_render_snapshot', 'creative_project', 'creative_scene', 'creative_image_ops',
  'creative_video_ops', 'creative_hyperframes_ops', 'creative_quality_ops',
]);

const READ_ONLY = /(?:read|grep|search|stats|validate|snapshot|state|list|get_|wait|diff)/i;
const BROWSER_DESKTOP_COMMIT_RE = /\b(?:submit|send|publish|purchase|buy|checkout|delete|remove|pay|transfer|post|upload|confirm|accept|place order|sign)\b/i;
const CREATIVE_DESTRUCTIVE_RE = /\b(?:delete|remove|clear|reset|publish|upload|overwrite project)\b/i;
const SHELL_DESTRUCTIVE_RE = /(?:^|[;&|]\s*)(?:rm|rmdir|del|erase|remove-item)\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|\b(?:format|shutdown|reboot)\b/i;

function allowedTools(domain: WorkContextDomain): Set<string> {
  if (domain === 'coding') return CODING_TOOLS;
  if (domain === 'browser') return BROWSER_TOOLS;
  if (domain === 'desktop') return DESKTOP_TOOLS;
  if (domain === 'creative') return CREATIVE_TOOLS;
  return new Set();
}

function startsWithHash(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  return Boolean(actual && actual.toLowerCase().startsWith(expected.trim().toLowerCase()));
}

function isMutatingStep(step: WorkContextFastPathStep): boolean {
  return !READ_ONLY.test(step.tool);
}

function validateCodingGuards(step: WorkContextFastPathStep): string | null {
  const patchLike = step.tool === 'apply_workspace_patchset'
    || step.tool === 'apply_dev_source_patchset'
    || (step.tool === 'workspace_edit' && String(step.args?.action || '').toLowerCase() === 'patchset');
  if (!patchLike) return null;
  const edits = Array.isArray(step.args?.edits) ? step.args!.edits : [];
  if (!edits.length) return `${step.tool} requires a non-empty edits array.`;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index] || {};
    const op = String(edit.op || '').toLowerCase();
    if (op === 'create' || op === 'create_file') continue;
    if (!String(edit.expected_hash || '').trim() && !String(edit.expected_before || '').trim()) {
      return `${step.tool} edits[${index}] must include expected_hash or expected_before on the warm fast path.`;
    }
  }
  return null;
}

export function preflightWorkContextFastPath(
  sessionId: string,
  raw: any,
  testOverrides?: { config?: ReturnType<typeof getWorkContextConfig>; packet?: WorkContextPacket | null },
): WorkContextFastPathPreflight {
  const config = testOverrides?.config || getWorkContextConfig();
  const domain = String(raw?.domain || '').trim().toLowerCase() as WorkContextDomain;
  const packet = testOverrides && Object.prototype.hasOwnProperty.call(testOverrides, 'packet')
    ? testOverrides.packet || null
    : getWorkContextPacket(sessionId);
  if (!config.enabled) return { ok: false, packet, steps: [], error: 'Work context is disabled.' };
  if (config.shadowMode) return { ok: false, packet, steps: [], error: 'Work context fast paths are in shadow mode.' };
  if (!['coding', 'browser', 'desktop', 'creative'].includes(domain)) return { ok: false, packet, steps: [], error: 'A supported domain is required.' };
  if (!config.fastPaths[domain]) return { ok: false, packet, steps: [], error: `${domain} fast path is disabled.` };
  if (!packet || packet.status !== 'active') return { ok: false, packet, steps: [], error: 'No active work context packet exists for this session.' };
  if (packet.activeDomain !== domain) return { ok: false, packet, steps: [], error: `Active work context domain is ${packet.activeDomain}, not ${domain}.` };
  if (packet.freshness === 'stale') return { ok: false, packet, steps: [], error: 'The work context packet is stale; reacquire focused state first.' };
  if (Number(raw?.expected_context_revision) !== packet.revision) {
    return { ok: false, packet, steps: [], error: `Work context revision mismatch: expected ${raw?.expected_context_revision}, current ${packet.revision}.` };
  }

  const steps = Array.isArray(raw?.steps) ? raw.steps.slice(0, 8).map((entry: any) => ({
    tool: String(entry?.tool || '').trim(),
    args: entry?.args && typeof entry.args === 'object' && !Array.isArray(entry.args) ? entry.args : {},
  })) : [];
  if (!steps.length) return { ok: false, packet, steps, error: 'steps must contain between 1 and 8 entries.' };
  if (Array.isArray(raw?.steps) && raw.steps.length > 8) return { ok: false, packet, steps, error: 'Fast paths are limited to 8 bounded steps.' };
  const allowed = allowedTools(domain);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!allowed.has(step.tool) || step.tool === 'work_context_execute') {
      return { ok: false, packet, steps, error: `steps[${index}].tool ${step.tool || '(empty)'} is not allowed on the ${domain} fast path.` };
    }
    let encoded = '';
    try { encoded = JSON.stringify(step.args); } catch { return { ok: false, packet, steps, error: `steps[${index}].args is not serializable.` }; }
    if (encoded.length > 100_000) return { ok: false, packet, steps, error: `steps[${index}].args exceeds the 100 KB fast-path limit.` };
    if ((domain === 'browser' || domain === 'desktop') && BROWSER_DESKTOP_COMMIT_RE.test(encoded)) {
      return { ok: false, packet, steps, error: `steps[${index}] crosses a browser/desktop commit boundary and must use the normal guarded tool path.` };
    }
    if (domain === 'creative' && CREATIVE_DESTRUCTIVE_RE.test(encoded)) {
      return { ok: false, packet, steps, error: `steps[${index}] contains a destructive Creative action and must use the normal guarded tool path.` };
    }
    const command = String(step.args?.command || '');
    if (domain === 'coding' && command && SHELL_DESTRUCTIVE_RE.test(command)) {
      return { ok: false, packet, steps, error: `steps[${index}] contains a destructive command and cannot use the fast path.` };
    }
    const codingGuardError = domain === 'coding' ? validateCodingGuards(step) : null;
    if (codingGuardError) return { ok: false, packet, steps, error: codingGuardError };
  }

  if (domain === 'browser') {
    if (raw.expected_url && String(raw.expected_url) !== String(packet.browser?.url || '')) {
      return { ok: false, packet, steps, error: 'Browser URL guard mismatch.' };
    }
    if (!startsWithHash(packet.browser?.contentHash, raw.expected_content_hash)) return { ok: false, packet, steps, error: 'Browser content hash guard mismatch.' };
    if (packet.browser?.pendingCommitBoundary && steps.some(isMutatingStep)) return { ok: false, packet, steps, error: packet.browser.pendingCommitBoundary };
  }
  if (domain === 'desktop') {
    if (raw.expected_window_handle && String(raw.expected_window_handle) !== String(packet.desktop?.activeWindowHandle || '')) {
      return { ok: false, packet, steps, error: 'Desktop window handle guard mismatch.' };
    }
    if (!startsWithHash(packet.desktop?.contentHash, raw.expected_content_hash)) return { ok: false, packet, steps, error: 'Desktop content hash guard mismatch.' };
    if (packet.desktop?.pendingCommitBoundary && steps.some(isMutatingStep)) return { ok: false, packet, steps, error: packet.desktop.pendingCommitBoundary };
  }
  if (domain === 'creative') {
    if (raw.expected_scene_version != null && Number(raw.expected_scene_version) !== Number(packet.creative?.sceneVersion)) {
      return { ok: false, packet, steps, error: 'Creative scene version guard mismatch.' };
    }
    if (!startsWithHash(packet.creative?.sceneHash, raw.expected_content_hash)) return { ok: false, packet, steps, error: 'Creative scene hash guard mismatch.' };
    if (steps.some(isMutatingStep) && packet.creative?.sceneVersion != null && raw.expected_scene_version == null && !raw.expected_content_hash) {
      return { ok: false, packet, steps, error: 'Creative mutation fast paths require expected_scene_version or expected_content_hash.' };
    }
  }

  return { ok: true, packet, steps };
}
