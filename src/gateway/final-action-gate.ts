/**
 * final-action-gate.ts — server-owned, mandatory final-action enforcement for
 * browser/desktop UI automation.
 *
 * Before this module, browser/desktop click and key handlers only consumed a
 * final-action grant when the model *chose* to pass final_action_approval_id.
 * Omitting the id simply performed the click (audit 2026-10-14, B-H2). Now every
 * consequential interaction handler calls enforceFinalActionGate():
 *
 *   1. If an approval id is supplied it is validated and consumed exactly as
 *      before (session, expiry, tool + argument binding, single use).
 *   2. Otherwise the runtime classifies the *target* (snapshot label of the
 *      clicked ref, accessibility name, OCR query, SOM label) with the shared
 *      ui-action-policy taxonomy. Consequential kinds (send/post/purchase/
 *      delete/permissions/install/financial) fail closed until the user grants
 *      a one-shot approval; hand-off kinds (captcha, password change, safety
 *      bypass) are refused outright.
 *
 * The classification input comes from runtime state (the last DOM snapshot,
 * resolved SOM element), never from model-written free text, so a model cannot
 * talk its way past the gate by describing a "Post" button as "Continue".
 * Pure pixel clicks with no resolvable label cannot be classified; that limit
 * is documented in SECURITY.md rather than hidden.
 *
 * Owner escape hatch: security.final_action_gate = "off" in config, or
 * PROMETHEUS_FINAL_ACTION_GATE=off. Lite permission mode does NOT disable it.
 */
import { evaluateUiActionRisk, type UiActionSurface } from './ui-action-policy';
import { consumeFinalActionApproval } from './final-action-approvals.js';

export type FinalActionGateMode = 'enforce' | 'off';

/** Decision kinds the gate enforces. login/upload are pre-approvable and stay advisory. */
export const ENFORCED_FINAL_ACTION_KINDS: ReadonlySet<string> = new Set([
  'final_submit',
  'delete_data',
  'account_create_final',
  'financial_or_medical',
  'permissions_or_keys',
  'install_software',
  'password_change_final',
  'bypass_safety',
  'captcha',
]);

const VERB_GATED_KINDS: ReadonlySet<string> = new Set(['financial_or_medical', 'permissions_or_keys', 'install_software']);
const reActionVerb = /\b(send|post|publish|submit|purchase|buy|pay|order|checkout|transfer|confirm|apply|install|add|grant|allow|authori[sz]e|share|invite|create|generate|save|update|approve|accept|enable|file)\b/i;

export function resolveFinalActionGateMode(): FinalActionGateMode {
  const env = String(process.env.PROMETHEUS_FINAL_ACTION_GATE || '').trim().toLowerCase();
  if (env === 'off' || env === '0' || env === 'false') return 'off';
  try {
    // Lazy require keeps this module importable from lightweight regressions.
    const { getConfig } = require('../config/config');
    const value = String((getConfig().getConfig() as any)?.security?.final_action_gate || '').trim().toLowerCase();
    if (value === 'off') return 'off';
  } catch { /* config unavailable: stay enforcing */ }
  return 'enforce';
}

/** Join runtime-derived target descriptors into one bounded classification string. */
export function buildUiActionIntent(parts: unknown[]): string {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 2000);
}

/** Extract only the SOM element description from a desktop sourceNote (never window titles). */
export function somLabelFromSourceNote(sourceNote: unknown): string {
  const match = String(sourceNote || '').match(/\[SOM #\d+ ([^\]]*?)\s*->/);
  return match ? match[1].trim() : '';
}

export type FinalActionGateResult =
  | { ok: true; approved: boolean; actionKind?: string }
  | { ok: false; actionKind: string; message: string };

export function enforceFinalActionGate(input: {
  sessionId: string;
  toolName: string;
  args: Record<string, any>;
  surface: UiActionSurface;
  /** Runtime-derived target description. Empty = unclassifiable (allowed, see SECURITY.md). */
  intent: string;
  /** Tool name used for the taxonomy when the real name does not reveal the input kind. */
  classifyAs?: string;
  mode?: FinalActionGateMode;
}): FinalActionGateResult {
  const args = input.args || {};
  const approvalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
  if (approvalId) {
    const grant = consumeFinalActionApproval({
      sessionId: input.sessionId,
      approvalId,
      toolName: input.toolName,
      toolArgs: args,
    });
    if (!grant.ok) return { ok: false, actionKind: 'final_action_grant', message: grant.message };
    return { ok: true, approved: true };
  }

  const mode = input.mode || resolveFinalActionGateMode();
  if (mode === 'off') return { ok: true, approved: false };

  const intent = String(input.intent || '').trim();
  if (!intent) return { ok: true, approved: false };

  const decision = evaluateUiActionRisk({
    surface: input.surface,
    toolName: input.classifyAs || input.toolName,
    intent,
    hasFinalActionApproval: false,
  });
  if (decision.mode === 'allow' || !ENFORCED_FINAL_ACTION_KINDS.has(decision.actionKind)) {
    return { ok: true, approved: false, actionKind: decision.actionKind };
  }
  // Noun-only kinds ("Bank of America" link, "Access settings" tab) are
  // navigation unless the target also carries an action verb.
  if (VERB_GATED_KINDS.has(decision.actionKind) && !reActionVerb.test(intent)) {
    return { ok: true, approved: false, actionKind: decision.actionKind };
  }
  const target = intent.slice(0, 160);
  if (decision.mode === 'handoff' || decision.mode === 'deny') {
    return {
      ok: false,
      actionKind: decision.actionKind,
      message: `Blocked by final-action gate (${decision.actionKind}) on target "${target}": ${decision.reason} Hand this step to the user instead of automating it.`,
    };
  }
  return {
    ok: false,
    actionKind: decision.actionKind,
    message: `Blocked by final-action gate (${decision.actionKind}) on target "${target}": ${decision.reason} Call request_final_action_approval with next_tool_name:"${input.toolName}", then retry this exact call with final_action_approval_id.`,
  };
}
