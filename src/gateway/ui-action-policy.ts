/**
 * ui-action-policy.ts — shared confirmation taxonomy for UI automation actions.
 *
 * Ported from the Codex Computer Use confirmation policy. Because desktop and
 * browser UI automation can trigger irreversible external side effects, this
 * module classifies a proposed action into one of four modes:
 *
 *   - allow:   always permitted (reading, navigation, screenshots, downloads…)
 *   - confirm: blocking confirmation required immediately before the action
 *   - handoff: the user must perform it themselves (or find an alternative)
 *   - deny:    never perform via UI automation in this product
 *
 * The intent is that the *tool layer* — not just the prompt — enforces
 * final-action approval. evaluateUiActionRisk() is the single decision point
 * both the desktop and browser tool dispatchers can call.
 */

export type UiActionSurface = 'desktop' | 'browser';

export type UiRiskMode = 'allow' | 'confirm' | 'handoff' | 'deny';

export interface UiRiskDecision {
  mode: UiRiskMode;
  /** Stable category label, e.g. "final_submit", "delete_data", "captcha". */
  actionKind: string;
  /** Human-readable reason shown to the user / model. */
  reason: string;
  /** True when an initial-prompt pre-approval can downgrade confirm→allow. */
  preApprovable?: boolean;
}

export interface UiActionContext {
  surface: UiActionSurface;
  /** The tool being invoked, e.g. "desktop_click", "browser_press_key". */
  toolName: string;
  /**
   * A free-text intent hint: the user's instruction and/or a description of
   * the element/target (button label, URL, field name) the action lands on.
   * Used only for keyword classification — never treated as permission.
   */
  intent?: string;
  /** True when this call carries a valid one-shot final-action approval id. */
  hasFinalActionApproval?: boolean;
  /** True when the initial user prompt pre-approved this specific action. */
  preApproved?: boolean;
}

const reHandoffPassword = /\b(change|reset|update)\b.*\bpassword\b|\bpassword\b.*\b(change|reset|update)\b/i;
const reBypassSafety = /\b(bypass|ignore|skip)\b.*\b(safety|warning|interstitial|paywall|not secure|certificate)\b|\bpaywall\b/i;
const reCaptcha = /\bcaptcha\b|\brecaptcha\b|\bhcaptcha\b|"i'?m not a robot"/i;
const reDelete = /\b(delete|remove|erase|trash|cancel)\b.*\b(account|email|post|file|message|appointment|reservation|calendar|meeting|subscription)\b|\bpermanently delete\b/i;
const reFinalSubmit = /\b(send|post|publish|submit|purchase|buy|pay|order|checkout|confirm|place order|transfer|apply)\b/i;
const reAccountCreate = /\b(create|sign up|register)\b.*\baccount\b|\bcreate account\b/i;
const rePermissions = /\b(permission|share|sharing|access|grant access|api key|oauth|token)\b/i;
const reInstall = /\b(install|add)\b.*\b(extension|add-?on|software|app)\b|\binstall\b/i;
const reFinancialMedical = /\b(invoice|wire|bank|credit card|tax|patient|prescription|medical|insurance claim)\b/i;
const reLogin = /\b(log ?in|sign ?in|authenticate)\b/i;
const reUpload = /\bupload\b|\battach\b.*\bfile\b/i;

/**
 * Classify a proposed UI automation action. Pure function — no side effects.
 */
export function evaluateUiActionRisk(ctx: UiActionContext): UiRiskDecision {
  const intent = String(ctx.intent || '').slice(0, 2000);
  const tool = String(ctx.toolName || '');

  // Read-only / navigational tools are always allowed regardless of intent.
  const readOnly = /(_screenshot|_snapshot|_list|_find|_get_|_doctor|_monitors|_window_text|_accessibility|_diff|_wait|_pixel_watch|_read|_navigate|_open$)/.test(tool);
  if (readOnly) {
    return { mode: 'allow', actionKind: 'read_or_navigate', reason: 'Read-only / navigation action.' };
  }

  // 1) Hand-off required — the user must do these themselves.
  if (reHandoffPassword.test(intent)) {
    return { mode: 'handoff', actionKind: 'password_change_final', reason: 'Submitting a password change/reset must be done by the user.' };
  }
  if (reBypassSafety.test(intent)) {
    return { mode: 'handoff', actionKind: 'bypass_safety', reason: 'Bypassing safety/paywall/interstitial barriers is not permitted via automation.' };
  }
  if (reCaptcha.test(intent)) {
    return { mode: 'handoff', actionKind: 'captcha', reason: 'CAPTCHAs must be solved by the user.' };
  }

  // 2) Always confirm at action-time (even if pre-approved is irrelevant here).
  if (reDelete.test(intent)) {
    return { mode: 'confirm', actionKind: 'delete_data', reason: 'Deleting/cancelling cloud or local data requires confirmation at action time.' };
  }
  if (reAccountCreate.test(intent)) {
    return { mode: 'confirm', actionKind: 'account_create_final', reason: 'Finalizing account creation requires confirmation.' };
  }
  if (rePermissions.test(intent)) {
    return { mode: 'confirm', actionKind: 'permissions_or_keys', reason: 'Changing permissions/access or creating API/OAuth keys requires confirmation.' };
  }
  if (reInstall.test(intent)) {
    return { mode: 'confirm', actionKind: 'install_software', reason: 'Installing/running newly acquired software or extensions requires confirmation.' };
  }
  if (reFinancialMedical.test(intent)) {
    return { mode: 'confirm', actionKind: 'financial_or_medical', reason: 'Financial/medical submissions require confirmation.' };
  }

  // Final-action verbs on input tools: send/post/submit/purchase/etc.
  const isInputTool = /(_click|_press_key|_type|_fill|_form_input|_drag)/.test(tool);
  if (isInputTool && reFinalSubmit.test(intent)) {
    if (ctx.hasFinalActionApproval) {
      return { mode: 'allow', actionKind: 'final_submit', reason: 'Final action carries a valid one-shot approval.' };
    }
    return {
      mode: 'confirm',
      actionKind: 'final_submit',
      reason: 'This appears to be a final send/post/publish/purchase/submit action; request explicit approval before it.',
    };
  }

  // 3) Pre-approval acceptable.
  if (reLogin.test(intent)) {
    return { mode: ctx.preApproved ? 'allow' : 'confirm', actionKind: 'login', reason: 'Logging in is fine when implied by the task; otherwise confirm.', preApprovable: true };
  }
  if (reUpload.test(intent)) {
    return { mode: ctx.preApproved ? 'allow' : 'confirm', actionKind: 'upload_file', reason: 'Uploading files is pre-approvable; otherwise confirm.', preApprovable: true };
  }

  // 4) Everything else is allowed.
  return { mode: 'allow', actionKind: 'ordinary_ui_action', reason: 'Ordinary UI interaction outside the confirmation taxonomy.' };
}

/** Convenience: should the tool layer block this action pending approval? */
export function uiActionRequiresApproval(ctx: UiActionContext): boolean {
  const d = evaluateUiActionRisk(ctx);
  return d.mode === 'confirm' || d.mode === 'handoff' || d.mode === 'deny';
}
