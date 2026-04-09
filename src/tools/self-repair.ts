/**
 * self-repair.ts — Prometheus Self-Repair Tool
 *
 * Flow:
 *   1. AI analyzes an error using read_source + list_source
 *   2. AI calls propose_repair() with error context + a unified diff patch
 *   3. The patch is stored in .prometheus/pending-repairs/<id>.json
 *   4. A formatted proposal is returned (Telegram sends it to the user)
 *   5. User replies /approve <id> or /reject <id> in Telegram
 *   6. On approval: patch is applied to src/, npm run build runs, gateway restarts
 *   7. On rejection or build failure: patch is discarded/reverted
 *
 * The AI CANNOT self-apply patches. The approval gate is enforced here.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { ToolResult } from '../types.js';

// ─── Repair Proposal Hook ─────────────────────────────────────────────────────
// server-v2 sets this callback at startup so propose_repair can trigger
// the Telegram button send without importing TelegramChannel directly.
// This keeps the tool layer free of gateway dependencies.
type RepairProposalHook = (repairId: string) => void;
let _repairProposalHook: RepairProposalHook | null = null;

export function setRepairProposalHook(fn: RepairProposalHook): void {
  _repairProposalHook = fn;
}

function emitRepairProposal(repairId: string): void {
  if (_repairProposalHook) {
    try { _repairProposalHook(repairId); } catch {}
  }
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPrometheusRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function getPrometheusDataDir(): string {
  const projectData = path.join(getPrometheusRoot(), '.prometheus');
  const homeData = path.join(os.homedir(), '.prometheus');
  return fs.existsSync(projectData) ? projectData : homeData;
}

function getPendingRepairsDir(): string {
  const dir = path.join(getPrometheusDataDir(), 'pending-repairs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRepairFilePath(id: string): string {
  return path.join(getPendingRepairsDir(), `${id}.json`);
}

// ─── Repair Record Type ───────────────────────────────────────────────────────

export interface PendingRepair {
  id: string;
  createdAt: number;
  errorSummary: string;
  rootCause: string;
  affectedFile: string;      // e.g. "src/gateway/telegram-channel.ts"
  affectedLines: string;     // e.g. "lines 45-52" (human-readable)
  fixDescription: string;    // plain English description of the fix
  changePlan?: string;       // full written change plan shown to user before approval
  patch: string;             // unified diff (git format)
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  taskId?: string;           // if triggered from a background task
  buildOutput?: string;      // populated after apply attempt
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

export function savePendingRepair(repair: PendingRepair): void {
  const filePath = getRepairFilePath(repair.id);
  fs.writeFileSync(filePath, JSON.stringify(repair, null, 2), 'utf-8');
}

export function loadPendingRepair(id: string): PendingRepair | null {
  const filePath = getRepairFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PendingRepair;
  } catch {
    return null;
  }
}

export function listPendingRepairs(): PendingRepair[] {
  const dir = getPendingRepairsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PendingRepair; }
      catch { return null; }
    })
    .filter((r): r is PendingRepair => r !== null && r.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function deletePendingRepair(id: string): boolean {
  const filePath = getRepairFilePath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── propose_repair tool ──────────────────────────────────────────────────────

export interface ProposeRepairArgs {
  error_summary: string;     // 1-2 sentence error description
  root_cause: string;        // What is the actual bug
  affected_file: string;     // e.g. "gateway/telegram-channel.ts" (relative to src/)
  affected_lines: string;    // e.g. "lines 45-52"
  fix_description: string;   // Plain English: what the fix does
  change_plan: string;       // Full written change plan (what/why/risks/affected files) — required
  patch: string;             // Unified diff patch (git format, paths relative to project root)
  task_id?: string;          // Optional: ID of the background task that hit the error
}

export async function executeProposeRepair(args: ProposeRepairArgs): Promise<ToolResult> {
  // Validate required fields
  const required: (keyof ProposeRepairArgs)[] = [
    'error_summary', 'root_cause', 'affected_file', 'fix_description', 'change_plan', 'patch',
  ];
  for (const field of required) {
    if (!args?.[field]?.toString().trim()) {
      return { success: false, error: `${field} is required. change_plan must contain the full written plan shown to the user before they approve.` };
    }
  }

  // Validate the patch looks like a unified diff
  const patchText = String(args.patch || '').trim();
  if (!patchText.includes('---') || !patchText.includes('+++') || !patchText.includes('@@')) {
    return {
      success: false,
      error: 'patch must be a valid unified diff (must contain ---, +++, and @@ markers)',
    };
  }

  // Dry-run the patch to make sure it applies cleanly before storing
  const root = getPrometheusRoot();
  const tmpPatch = path.join(os.tmpdir(), `prometheus-repair-check-${Date.now()}.patch`);
  try {
    fs.writeFileSync(tmpPatch, patchText, 'utf-8');
    execSync(`git apply --check --whitespace=nowarn "${tmpPatch}"`, {
      cwd: root,
      stdio: 'pipe',
    });
  } catch (checkErr: any) {
    const details = String(checkErr?.stderr || checkErr?.stdout || checkErr?.message || 'unknown').trim();
    return {
      success: false,
      error: `Patch dry-run failed — it does not apply cleanly to current source:\n${details}\n\nDouble-check the diff context lines match the actual file content.`,
    };
  } finally {
    try { fs.unlinkSync(tmpPatch); } catch {}
  }

  // Generate a short ID for the repair
  const id = randomUUID().slice(0, 8);

  const repair: PendingRepair = {
    id,
    createdAt: Date.now(),
    errorSummary: String(args.error_summary).trim(),
    rootCause: String(args.root_cause).trim(),
    affectedFile: `src/${String(args.affected_file).replace(/^src\//, '').trim()}`,
    affectedLines: String(args.affected_lines || 'unspecified').trim(),
    fixDescription: String(args.fix_description).trim(),
    changePlan: String(args.change_plan).trim(),
    patch: patchText,
    status: 'pending',
    taskId: args.task_id ? String(args.task_id).trim() : undefined,
  };

  savePendingRepair(repair);

  // Trigger Telegram button send (hook wired up by server-v2 at startup)
  emitRepairProposal(id);

  // Also include text proposal in stdout for web UI / non-Telegram contexts
  const proposal = formatRepairProposal(repair);

  return {
    success: true,
    data: { repair_id: id, repair },
    stdout: proposal,
  };
}

export function formatRepairProposal(repair: PendingRepair): string {
  const lines = [
    `🔧 <b>Src Change Proposal #${repair.id}</b>`,
    ``,
    `📍 <b>File:</b> <code>${repair.affectedFile}</code> (${repair.affectedLines})`,
    ``,
    `❌ <b>Summary:</b>`,
    repair.errorSummary,
    ``,
    `🔍 <b>Root Cause:</b>`,
    repair.rootCause,
    ``,
    `🩹 <b>Proposed Fix:</b>`,
    repair.fixDescription,
  ];

  if (repair.changePlan) {
    lines.push(
      ``,
      `📋 <b>Change Plan:</b>`,
      repair.changePlan.slice(0, 1200),
    );
  }

  lines.push(
    ``,
    `<pre>${repair.patch.slice(0, 1000)}${repair.patch.length > 1000 ? '\n...(truncated)' : ''}</pre>`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Use the <b>✅ Approve</b> / <b>❌ Reject</b> buttons above, or:`,
    `Reply <b>/approve ${repair.id}</b> to apply, rebuild, and restart.`,
    `Reply <b>/reject ${repair.id}</b> to discard.`,
  );
  return lines.join('\n');
}

/**
 * Returns the payload needed to send an inline-button repair proposal via Telegram.
 * Used by telegram-channel.ts to build the reply_markup.
 */
export function getRepairButtonPayload(repair: PendingRepair): {
  text: string;
  repairId: string;
} {
  return {
    text: formatRepairProposal(repair),
    repairId: repair.id,
  };
}

export const proposeRepairTool = {
  name: 'propose_repair',
  description:
    '[DEPRECATED — prefer write_proposal with requires_src_edit: true for new src changes. ' +
    'Use propose_repair only for emergency single-file patches via git apply.] ' +
    'Propose a src/ code change (repair or new feature). ' +
    'BEFORE calling this you MUST: (1) read workspace/SELF.md, (2) read the relevant src/ file(s) via read_source, ' +
    '(3) write a full CHANGE PLAN to chat (what/why/risks/affected files), THEN call this tool. ' +
    'The patch is stored pending and sent to the user with ✅ Approve / ❌ Reject buttons. ' +
    'The patch is NEVER applied automatically — user approval is mandatory. ' +
    'Pass the full change_plan text you already wrote to chat — it will be shown alongside the buttons.',
  execute: executeProposeRepair,
  schema: {
    error_summary: 'string (required) — 1-2 sentence description of the problem or feature request',
    root_cause: 'string (required) — technical explanation of the cause or motivation',
    affected_file: 'string (required) — file path relative to src/, e.g. "gateway/telegram-channel.ts"',
    affected_lines: 'string (required) — human-readable line range, e.g. "lines 45-52"',
    fix_description: 'string (required) — plain English description of what the change does',
    change_plan: 'string (required) — the full change plan you already wrote to chat (what/why/risks/affected files)',
    patch: 'string (required) — unified diff patch in git format (paths relative to project root)',
    task_id: 'string (optional) — ID of the background task that encountered the error',
  },
  jsonSchema: {
    type: 'object',
    required: ['error_summary', 'root_cause', 'affected_file', 'affected_lines', 'fix_description', 'change_plan', 'patch'],
    properties: {
      error_summary: { type: 'string' },
      root_cause: { type: 'string' },
      affected_file: { type: 'string' },
      affected_lines: { type: 'string' },
      fix_description: { type: 'string' },
      change_plan: { type: 'string' },
      patch: { type: 'string' },
      task_id: { type: 'string' },
    },
    additionalProperties: false,
  },
};

// ─── Apply + Build (called by Telegram /approve handler) ─────────────────────

export interface ApplyRepairResult {
  success: boolean;
  repairId: string;
  message: string;
  buildOutput?: string;
}

export async function applyApprovedRepair(repairId: string): Promise<ApplyRepairResult> {
  const repair = loadPendingRepair(repairId);
  if (!repair) {
    return { success: false, repairId, message: `No pending repair found with ID: ${repairId}` };
  }
  if (repair.status !== 'pending') {
    return { success: false, repairId, message: `Repair #${repairId} is not pending (status: ${repair.status})` };
  }

  const root = getPrometheusRoot();
  const tmpPatch = path.join(os.tmpdir(), `prometheus-repair-apply-${Date.now()}.patch`);

  try {
    fs.writeFileSync(tmpPatch, repair.patch, 'utf-8');

    // Step 1: Final check before apply
    try {
      execSync(`git apply --check --whitespace=nowarn "${tmpPatch}"`, { cwd: root, stdio: 'pipe' });
    } catch (checkErr: any) {
      const details = String(checkErr?.stderr || checkErr?.message || '').slice(0, 500);
      repair.status = 'failed';
      repair.buildOutput = `Patch no longer applies cleanly:\n${details}`;
      savePendingRepair(repair);
      return {
        success: false,
        repairId,
        message: `❌ Repair #${repairId} — patch no longer applies (source may have changed).\n\n${details}`,
      };
    }

    // Step 2: Apply the patch
    execSync(`git apply --whitespace=nowarn "${tmpPatch}"`, { cwd: root, stdio: 'pipe' });
    repair.status = 'approved';
    savePendingRepair(repair);

  } catch (applyErr: any) {
    const details = String(applyErr?.stderr || applyErr?.message || '').slice(0, 500);
    repair.status = 'failed';
    repair.buildOutput = `Patch apply failed:\n${details}`;
    savePendingRepair(repair);
    return { success: false, repairId, message: `❌ Failed to apply patch #${repairId}:\n\n${details}` };
  } finally {
    try { fs.unlinkSync(tmpPatch); } catch {}
  }

  // Step 3: Build
  let buildOutput = '';
  try {
    buildOutput = execSync('npm run build', {
      cwd: root,
      encoding: 'utf-8',
      timeout: 120_000, // 2 min build timeout
      stdio: 'pipe',
    });
    repair.status = 'applied';
    repair.buildOutput = buildOutput.slice(0, 1000);
    savePendingRepair(repair);
  } catch (buildErr: any) {
    buildOutput = String(buildErr?.stderr || buildErr?.stdout || buildErr?.message || '').slice(0, 800);
    repair.status = 'failed';
    repair.buildOutput = buildOutput;
    savePendingRepair(repair);

    // Revert the patch since build failed
    const revertPatch = path.join(os.tmpdir(), `prometheus-repair-revert-${Date.now()}.patch`);
    try {
      fs.writeFileSync(revertPatch, repair.patch, 'utf-8');
      execSync(`git apply --reverse --whitespace=nowarn "${revertPatch}"`, { cwd: root, stdio: 'pipe' });
    } catch {
      // Revert also failed — leave a note
      repair.buildOutput += '\n\n⚠️ Auto-revert also failed. Source may be in a modified state.';
      savePendingRepair(repair);
    } finally {
      try { fs.unlinkSync(revertPatch); } catch {}
    }

    return {
      success: false,
      repairId,
      message: `❌ Patch applied but <b>build failed</b> — patch has been reverted.\n\n<pre>${buildOutput.slice(0, 600)}</pre>`,
      buildOutput,
    };
  }

  // Step 4: Restart gateway (same pattern as self-update.ts)
  triggerGatewayRestart(root, repairId);

  return {
    success: true,
    repairId,
    message: `✅ Repair #${repairId} applied and built successfully!\n\n📍 Fixed: <code>${repair.affectedFile}</code>\n\nGateway is restarting now — I'll be back in a moment.`,
    buildOutput,
  };
}

/** Spawns restart detached so the current process can exit cleanly */
function triggerGatewayRestart(root: string, repairId: string): void {
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      const batPath = path.join(root, 'start-prometheus.bat');
      if (fs.existsSync(batPath)) {
        const child = spawn('cmd.exe', ['/c', batPath], {
          cwd: root, detached: true, stdio: 'ignore', windowsHide: false,
        });
        child.unref();
        return;
      }
    }
    // Cross-platform fallback
    const child = spawn('npm', ['start'], { cwd: root, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err: any) {
    console.error(`[self-repair] Restart failed after applying repair #${repairId}:`, err.message);
  }
}
