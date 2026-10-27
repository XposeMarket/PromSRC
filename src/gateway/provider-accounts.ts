/**
 * Pure helpers for provider account removal/update. No I/O: callers persist the
 * returned config patch. Inputs are never mutated (deep clone).
 */

export const ACCOUNT_AWARE_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'xai', 'openai_codex', 'anthropic']);

const MAX_LABEL = 64;

export interface AccountRemovalPlan {
  ok: boolean;
  error?: string;
  providerId: string;
  accountId: string;
  nextDefaultAccountId: string | null;
  affectedRoles: string[];
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

  delete accounts[aid];
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
    nextConfigPatch: { llm, agent_model_default_accounts: roleAccounts },
  };
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