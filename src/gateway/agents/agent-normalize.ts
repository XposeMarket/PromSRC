export function sanitizeAgentId(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAgentDefinition(raw: any, fallbackId?: string): any {
  const id = sanitizeAgentId(raw?.id || fallbackId || '');
  const normalized: any = {
    id,
    name: String(raw?.name || id || 'Agent').trim() || 'Agent',
  };
  if (raw?.description !== undefined) normalized.description = String(raw.description || '').trim();
  if (raw?.emoji !== undefined) normalized.emoji = String(raw.emoji || '').trim();
  if (raw?.identity && typeof raw.identity === 'object') normalized.identity = raw.identity;
  if (raw?.roleType !== undefined) normalized.roleType = String(raw.roleType || '').trim();
  if (raw?.teamRole !== undefined) normalized.teamRole = String(raw.teamRole || '').trim();
  if (raw?.teamAssignment !== undefined) normalized.teamAssignment = String(raw.teamAssignment || '').trim();
  if (raw?.workspace !== undefined) normalized.workspace = String(raw.workspace || '').trim();
  if (raw?.executionWorkspace !== undefined) normalized.executionWorkspace = String(raw.executionWorkspace || '').trim();
  if (Array.isArray(raw?.allowedWorkPaths)) normalized.allowedWorkPaths = raw.allowedWorkPaths.map((s: any) => String(s || '').trim()).filter(Boolean);
  if (raw?.marketplaceProfile && typeof raw.marketplaceProfile === 'object') normalized.marketplaceProfile = raw.marketplaceProfile;
  if (raw?.model !== undefined) normalized.model = String(raw.model || '').trim();
  if (Array.isArray(raw?.skillIds)) {
    normalized.skillIds = Array.from(new Set(raw.skillIds.map((s: any) => String(s || '').trim()).filter(Boolean)));
  }
  if (typeof raw?.default === 'boolean') normalized.default = raw.default;
  if (raw?.maxSteps !== undefined) {
    const n = Number(raw.maxSteps);
    if (Number.isFinite(n) && n > 0) normalized.maxSteps = Math.floor(n);
  }
  if (raw?.tools && typeof raw.tools === 'object') {
    normalized.tools = {};
    if (Array.isArray(raw.tools.allow)) normalized.tools.allow = raw.tools.allow.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (Array.isArray(raw.tools.deny)) normalized.tools.deny = raw.tools.deny.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (!normalized.tools.allow && !normalized.tools.deny) delete normalized.tools;
  }
  if (Array.isArray(raw?.bindings)) {
    normalized.bindings = raw.bindings
      .filter((b: any) => b && ['telegram', 'discord', 'whatsapp'].includes(String(b.channel || '')))
      .map((b: any) => ({
        channel: String(b.channel),
        ...(b.accountId ? { accountId: String(b.accountId) } : {}),
        ...(b.peerId ? { peerId: String(b.peerId) } : {}),
      }));
  }
  if (raw?.subagentType !== undefined) normalized.subagentType = raw.subagentType;
  if (raw?.scheduleId !== undefined) normalized.scheduleId = String(raw.scheduleId || '').trim();
  if (raw?.scheduleName !== undefined) normalized.scheduleName = String(raw.scheduleName || '').trim();
  if (raw?.createdAt !== undefined) normalized.createdAt = raw.createdAt;
  if (raw?.createdBy !== undefined) normalized.createdBy = raw.createdBy;
  if (Array.isArray(raw?.allowed_tools)) normalized.allowed_tools = raw.allowed_tools;
  if (Array.isArray(raw?.forbidden_tools)) normalized.forbidden_tools = raw.forbidden_tools;
  if (Array.isArray(raw?.constraints)) normalized.constraints = raw.constraints;
  if (raw?.system_instructions !== undefined) normalized.system_instructions = String(raw.system_instructions || '').trim();
  if (raw?.success_criteria !== undefined) normalized.success_criteria = String(raw.success_criteria || '').trim();
  if (typeof raw?.isTeamManager === 'boolean') normalized.isTeamManager = raw.isTeamManager;
  return normalized;
}

export function normalizeAgentsForSave(incomingAgents: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const raw of incomingAgents || []) {
    const n = normalizeAgentDefinition(raw);
    if (!n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  const explicitMain = out.find((a) => a.id === 'main');
  if (explicitMain) {
    for (const a of out) a.default = a.id === 'main';
  } else {
    for (const a of out) {
      if (a.default === true) delete a.default;
    }
  }
  return out;
}
