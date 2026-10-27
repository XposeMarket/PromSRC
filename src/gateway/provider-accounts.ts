/**
 * Pure helpers for provider account removal/update. No I/O: callers persist the
 * returned config patch. Inputs are never mutated (deep clone).
 */

export const ACCOUNT_AWARE_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'xai', 'openai_codex', 'anthropic']);

const MAX_LABEL = 64;
// Removed account ids are kept per provider so a stale Settings surface (phone
// and desktop open at once) cannot write a removed account back on Save.
const MAX_TOMBSTONES = 50;

export interface AccountRemovalPlan {
  ok: boolean;
  error?: string;
  providerId: string;
  accountId: string;
  nextDefaultAccountId: string | null;
  affectedRoles: string[];
  /** Legacy single-account credentials that only the removed "default" account used. */
  legacyCredentials: { providerApiKey: boolean; unscopedOAuth: boolean };
  nextConfigPatch: { llm: any; agent_model_default_accounts: Record<string, string> };
}

export interface AccountUpdatePlan {
  ok: boolean;
  error?: string;
  nextConfigPatch?: { llm: any };
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function failRemoval(providerId: string, accountId: string, error: string): AccountRemovalPlan {
  return {
    ok: false,
    error,
    providerId,
    accountId,
    nextDefaultAccountId: null,
    affectedRoles: [],
    legacyCredentials: { providerApiKey: false, unscopedOAuth: false },
    nextConfigPatch: { llm: null, agent_model_default_accounts: {} },
  };
}

export function planRemoveProviderAccount(config: any, providerId: string, accountId: string): AccountRemovalPlan {
  const pid = String(providerId || '').trim();
  const aid = String(accountId || '').trim();
  if (!ACCOUNT_AWARE_PROVIDERS.has(pid)) return failRemoval(pid, aid, `Unknown provider: ${pid || '(empty)'}`);
  if (!aid) return failRemoval(pid, aid, 'accountId is required');

  const llm = clone(isPlainObject(config?.llm) ? config.llm : {});
  const providerCfg = isPlainObject(llm.providers?.[pid]) ? llm.providers[pid] : null;
  const accounts = isPlainObject(providerCfg?.accounts) ? providerCfg.accounts : null;
  if (!providerCfg || !accounts || !Object.prototype.hasOwnProperty.call(accounts, aid)) {
    return failRemoval(pid, aid, `Unknown account ${aid} for ${pid}`);
  }

  // The only account cannot be removed: an empty accounts map makes the
  // provider fall back to legacy single-account mode (synthesized "default",
  // provider-level key, unscoped OAuth token), so the account would reappear
  // as connected. Signing out is the provider-level action (Disconnect).
  if (Object.keys(accounts).length <= 1) {
    return failRemoval(pid, aid, `This is the only ${pid} account. Sign out with Disconnect under Manage connection instead.`);
  }

  delete accounts[aid];
  providerCfg.removed_account_ids = [...idList(providerCfg.removed_account_ids).filter((id) => id !== aid), aid].slice(-MAX_TOMBSTONES);

  // A "default" account on a legacy config is backed by the provider-level
  // api_key (factory.ts falls back to it) and, for Codex, the unscoped OAuth
  // token. Removing it must remove those too, or the credential stays live.
  const legacyCredentials = { providerApiKey: false, unscopedOAuth: false };
  if (aid === 'default') {
    if (typeof providerCfg.api_key === 'string' && providerCfg.api_key.trim()) {
      delete providerCfg.api_key;
      legacyCredentials.providerApiKey = true;
    }
    legacyCredentials.unscopedOAuth = pid === 'openai_codex';
  }
  const remainingIds = Object.keys(accounts);
  const nextDefaultAccountId = remainingIds[0] ?? null;
  const currentDefault = String(providerCfg.defaultAccountId || '');
  if (!currentDefault || currentDefault === aid || !accounts[currentDefault]) {
    if (nextDefaultAccountId) providerCfg.defaultAccountId = nextDefaultAccountId;
    else delete providerCfg.defaultAccountId;
  }

  if (llm.provider === pid && String(llm.accountId || '') === aid) {
    if (nextDefaultAccountId) llm.accountId = nextDefaultAccountId;
    else delete llm.accountId;
  }

  const defaults: Record<string, any> = isPlainObject(config?.agent_model_defaults) ? config.agent_model_defaults : {};
  const roleAccounts: Record<string, string> = clone(isPlainObject(config?.agent_model_default_accounts) ? config.agent_model_default_accounts : {});
  const affectedRoles: string[] = [];
  for (const [role, mappedAccount] of Object.entries(roleAccounts)) {
    const modelRef = String(defaults[role] || '');
    if (mappedAccount === aid && modelRef.startsWith(`${pid}/`)) {
      affectedRoles.push(role);
      delete roleAccounts[role];
    }
  }

  llm.providers[pid] = providerCfg;
  return {
    ok: true,
    providerId: pid,
    accountId: aid,
    nextDefaultAccountId,
    affectedRoles,
    legacyCredentials,
    nextConfigPatch: { llm, agent_model_default_accounts: roleAccounts },
  };
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => String(id || '').trim()).filter(Boolean) : [];
}

/**
 * Drop accounts removed earlier from an incoming full-provider Save. A Settings
 * surface loaded before a removal still holds the removed account and would
 * write it back (without its credentials). Tombstones from the current config
 * and the incoming payload are unioned. Never empties an accounts map: an empty
 * map falls back to legacy single-account mode.
 */
export function dropRemovedAccounts(nextLlm: any, currentLlm: any): any {
  if (!isPlainObject(nextLlm) || !isPlainObject(nextLlm.providers)) return nextLlm;
  const out = clone(nextLlm);
  for (const pid of ACCOUNT_AWARE_PROVIDERS) {
    const next = out.providers[pid];
    if (!isPlainObject(next)) continue;
    const removed = new Set<string>([
      ...idList(currentLlm?.providers?.[pid]?.removed_account_ids),
      ...idList(next.removed_account_ids),
    ]);
    if (!removed.size) continue;
    next.removed_account_ids = [...removed].slice(-MAX_TOMBSTONES);
    if (!isPlainObject(next.accounts)) continue;
    const kept = Object.fromEntries(Object.entries(next.accounts).filter(([id]) => !removed.has(id)));
    if (!Object.keys(kept).length || Object.keys(kept).length === Object.keys(next.accounts).length) continue;
    next.accounts = kept;
    if (!kept[String(next.defaultAccountId || '')]) next.defaultAccountId = Object.keys(kept)[0];
    if (out.provider === pid && out.accountId && !kept[String(out.accountId)]) out.accountId = next.defaultAccountId;
  }
  return out;
}

export function planUpdateProviderAccount(
  config: any,
  providerId: string,
  accountId: string,
  patch: { label?: string; makeDefault?: boolean },
): AccountUpdatePlan {
  const pid = String(providerId || '').trim();
  const aid = String(accountId || '').trim();
  if (!ACCOUNT_AWARE_PROVIDERS.has(pid)) return { ok: false, error: `Unknown provider: ${pid || '(empty)'}` };
  if (!aid) return { ok: false, error: 'accountId is required' };

  const llm = clone(isPlainObject(config?.llm) ? config.llm : {});
  const providerCfg = isPlainObject(llm.providers?.[pid]) ? llm.providers[pid] : null;
  const accounts = isPlainObject(providerCfg?.accounts) ? providerCfg.accounts : null;
  if (!providerCfg || !accounts || !isPlainObject(accounts[aid])) {
    return { ok: false, error: `Unknown account ${aid} for ${pid}` };
  }

  if (patch.label !== undefined) {
    const label = String(patch.label).trim();
    if (!label) return { ok: false, error: 'Account name cannot be empty' };
    if (label.length > MAX_LABEL) return { ok: false, error: `Account name must be ${MAX_LABEL} characters or fewer` };
    accounts[aid].label = label;
  }

  if (patch.makeDefault) {
    providerCfg.defaultAccountId = aid;
    if (llm.provider === pid) llm.accountId = aid;
  }

  llm.providers[pid] = providerCfg;
  return { ok: true, nextConfigPatch: { llm } };
}