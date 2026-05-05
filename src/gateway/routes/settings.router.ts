// src/gateway/routes/settings.router.ts
// Settings, Credentials, Model, Auth, Memory, Hooks routes
import { Router } from 'express';
import { getConfig } from '../../config/config';
import { getVault } from '../../security/vault';
import { getMCPManager } from '../mcp-manager';
import { resolveHookConfig, buildWebhookRouter } from '../comms/webhook-handler';
import { getOllamaClient } from '../../agents/ollama-client';
import { getCredentialHandler } from '../../security/credential-handler';
import * as fs from 'fs';
import * as path from 'path';
import {
  getInstalledAppsInventory,
  searchInstalledApps,
  saveInstalledAppAlias,
  deleteInstalledAppAlias,
} from '../installed-apps.js';
// providers/factory and auth/openai-oauth are loaded lazily to avoid missing-module errors
const getProvider = (...args: any[]) => require('../../providers/factory').getProvider(...args);
const resetProvider = (...args: any[]) => require('../../providers/factory').resetProvider(...args);
const buildProviderForLLM = (...args: any[]) => require('../../providers/factory').buildProviderForLLM(...args);
const startOAuthFlow = (...args: any[]) => require('../../auth/openai-oauth').startOAuthFlow(...args);
const startOAuthFlowBackground = (...args: any[]) => require('../../auth/openai-oauth').startOAuthFlowBackground(...args);
const pollOAuthBackground = () => require('../../auth/openai-oauth').pollOAuthBackground();
const isConnected = (...args: any[]) => require('../../auth/openai-oauth').isConnected(...args);
const clearTokens = (...args: any[]) => require('../../auth/openai-oauth').clearTokens(...args);
const loadTokens = (...args: any[]) => require('../../auth/openai-oauth').loadTokens(...args);
const exchangeManualCodeFromPending = (...args: any[]) => require('../../auth/openai-oauth').exchangeManualCodeFromPending(...args);
// Anthropic auth (setup-token flow)
const anthropicIsConnected = (...args: any[]) => require('../../auth/anthropic-oauth').isConnected(...args);
const anthropicLoadTokens  = (...args: any[]) => require('../../auth/anthropic-oauth').loadTokens(...args);
const anthropicClearTokens = (...args: any[]) => require('../../auth/anthropic-oauth').clearTokens(...args);
const anthropicStoreSetupToken = (...args: any[]) => require('../../auth/anthropic-oauth').storeSetupToken(...args);
import { detectGpu } from '../gpu-detector';
import { getApprovalQueue } from '../verification-flow';
import { requireGatewayAuth as sharedRequireGatewayAuth } from '../gateway-auth';
import { listProviderSecretFieldPaths } from '../../providers/provider-registry.js';

export const router = Router();

const CONFIG_DIR_PATH = getConfig().getConfigDir();

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizePathForCompare(basePath);
  const target = normalizePathForCompare(targetPath);
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

let _requireGatewayAuth: any;
export function initSettingsRouter(deps: { requireGatewayAuth: any }): void {
  _requireGatewayAuth = deps.requireGatewayAuth;
}
const requireGatewayAuth = (...args: any[]) => _requireGatewayAuth ? _requireGatewayAuth(...args) : (sharedRequireGatewayAuth as any)(...args);

// ─── Settings API ────────────────────────────────────────────────────────────────

router.get('/api/settings/search', (_req, res) => {
  const cm = getConfig();
  const cfg = (cm.getConfig() as any).search || {};
  // Resolve then mask — never send actual key values to the browser.
  // Returns '••••••••' if a key is present (vault or plaintext), '' if not set.
  const maskIfSet = (val: string | undefined): string => {
    if (!val) return '';
    const resolved = cm.resolveSecret(val);
    return resolved ? '••••••••' : '';
  };
  res.json({
    preferred_provider: cfg.preferred_provider || 'tavily',
    search_rigor: cfg.search_rigor || 'verified',
    tavily_api_key: maskIfSet(cfg.tavily_api_key),
    google_api_key: maskIfSet(cfg.google_api_key),
    // Stored in the vault for persistence, but returned resolved so the UI can
    // keep showing the saved CSE ID without making users re-enter it.
    google_cx: cm.resolveSecret(cfg.google_cx) || '',
    brave_api_key: maskIfSet(cfg.brave_api_key),
  });
});

router.post('/api/settings/search', (req, res) => {
  const { preferred_provider, search_rigor, tavily_api_key, google_api_key, google_cx, brave_api_key } = req.body;
  const cm = getConfig();
  const current = cm.getConfig() as any;
  // Only write a key field if the user actually entered a new value.
  // '••••••••' means "leave existing vault entry alone".
  const isNew = (v: any) => v !== undefined && v !== '' && v !== '••••••••';
  const newSearch = {
    ...((current.search || {})),
    ...(preferred_provider !== undefined && { preferred_provider }),
    ...(search_rigor !== undefined && { search_rigor }),
    ...(isNew(tavily_api_key) && { tavily_api_key }),
    ...(isNew(google_api_key) && { google_api_key }),
    ...(google_cx !== undefined && { google_cx }),
    ...(isNew(brave_api_key) && { brave_api_key }),
  };
  cm.updateConfig({ search: newSearch } as any);
  // migrateSecretsToVault() runs inside updateConfig → saveConfig, so any
  // plaintext key just entered is automatically encrypted and replaced with
  // a "vault:<key>" reference before hitting disk.
  res.json({ success: true });
});

// GET /api/credentials/status — list which vault keys are currently stored (names only, no values)
router.get('/api/credentials/status', (_req, res) => {
  try {
    const vault = getVault();
    res.json({ success: true, keys: vault.keys() });
  } catch (err: any) {
    res.json({ success: false, keys: [], error: err.message });
  }
});

// GET /api/credentials/audit — return last N lines of vault-audit.log (scrubbed)
router.get('/api/credentials/audit', (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const auditPath = path.join(process.cwd(), '.prometheus', 'vault', 'vault-audit.log');
    if (!fs.existsSync(auditPath)) { res.json({ success: true, lines: [] }); return; }
    const raw = fs.readFileSync(auditPath, 'utf-8');
    const lines = raw.split('\n').filter((l: string) => l.trim());
    res.json({ success: true, lines: lines.slice(-40) });
  } catch (err: any) {
    res.json({ success: false, lines: [], error: err.message });
  }
});

router.get('/api/settings/paths', (_req, res) => {
  const cfg = getConfig().getConfig();
  res.json({
    workspace_path: (cfg as any).workspace?.path || '',
    allowed_paths: (cfg as any).tools?.permissions?.files?.allowed_paths || [],
    blocked_paths: (cfg as any).tools?.permissions?.files?.blocked_paths || [],
  });
});

router.post('/api/settings/paths', (req, res) => {
  const { workspace_path, allowed_paths, blocked_paths } = req.body;
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const workspacePath = typeof workspace_path === 'string' ? workspace_path.trim() : '';
  const normalizedAllowed = Array.from(new Set(
    [
      ...((Array.isArray(allowed_paths) ? allowed_paths : []).map((p: any) => String(p || '').trim()).filter(Boolean)),
      ...(workspacePath ? [workspacePath] : []),
    ].map((p) => path.resolve(p)),
  ));
  const normalizedBlocked = Array.from(new Set(
    (Array.isArray(blocked_paths) ? blocked_paths : [])
      .map((p: any) => String(p || '').trim())
      .filter(Boolean)
      .map((p: string) => path.resolve(p)),
  ));
  const tools = {
    ...current.tools,
    permissions: {
      ...current.tools?.permissions,
      files: {
        ...(current.tools?.permissions?.files || {}),
        allowed_paths: normalizedAllowed,
        blocked_paths: normalizedBlocked,
      },
    },
  };
  if (workspacePath) {
    try { fs.mkdirSync(workspacePath, { recursive: true }); } catch {}
  }
  cm.updateConfig({
    tools,
    ...(workspacePath ? { workspace: { ...(current.workspace || {}), path: workspacePath } } : {}),
  } as any);
  res.json({ success: true });
});

router.get('/api/installed-apps', async (req, res) => {
  try {
    const filter = String(req.query?.filter || '').trim();
    const refresh = String(req.query?.refresh || '').trim() === '1' || String(req.query?.refresh || '').trim().toLowerCase() === 'true';
    const limitRaw = Number(req.query?.limit || 250);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 250, 1), 1000);
    const inventory = await getInstalledAppsInventory({ refresh });
    const apps = filter
      ? await searchInstalledApps(filter, { limit, refresh: false })
      : inventory.apps.slice(0, limit);
    res.json({
      success: true,
      generatedAt: inventory.generatedAt,
      total: inventory.apps.length,
      apps,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/installed-apps/search', async (req, res) => {
  try {
    const query = String(req.query?.query || '').trim();
    const refresh = String(req.query?.refresh || '').trim() === '1' || String(req.query?.refresh || '').trim().toLowerCase() === 'true';
    const limitRaw = Number(req.query?.limit || 20);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20, 1), 100);
    if (!query) {
      return res.status(400).json({ success: false, error: 'query is required' });
    }
    const inventory = await getInstalledAppsInventory({ refresh });
    const apps = await searchInstalledApps(query, { limit, refresh: false });
    res.json({
      success: true,
      generatedAt: inventory.generatedAt,
      total: inventory.apps.length,
      apps,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/installed-apps/aliases', async (req, res) => {
  try {
    const appId = String(req.body?.app_id || '').trim();
    const alias = String(req.body?.alias || '').trim();
    if (!appId || !alias) {
      return res.status(400).json({ success: false, error: 'app_id and alias are required' });
    }
    const app = await saveInstalledAppAlias(appId, alias);
    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/installed-apps/aliases', async (req, res) => {
  try {
    const appId = String(req.body?.app_id || '').trim();
    const alias = String(req.body?.alias || '').trim();
    if (!appId || !alias) {
      return res.status(400).json({ success: false, error: 'app_id and alias are required' });
    }
    const app = await deleteInstalledAppAlias(appId, alias);
    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/settings/agent', (_req, res) => {
  const cfg = (getConfig().getConfig() as any).agent_policy || {};
  res.json({
    force_web_for_fresh: cfg.force_web_for_fresh !== false,
    memory_fallback_on_search_failure: cfg.memory_fallback_on_search_failure !== false,
    auto_store_web_facts: cfg.auto_store_web_facts !== false,
    natural_language_tool_router: cfg.natural_language_tool_router !== false,
    retrieval_mode: cfg.retrieval_mode || 'standard',
  });
});

router.post('/api/settings/agent', (req, res) => {
  const { force_web_for_fresh, memory_fallback_on_search_failure, auto_store_web_facts, natural_language_tool_router, retrieval_mode } = req.body;
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const newPolicy = {
    ...(current.agent_policy || {}),
    ...(force_web_for_fresh !== undefined && { force_web_for_fresh }),
    ...(memory_fallback_on_search_failure !== undefined && { memory_fallback_on_search_failure }),
    ...(auto_store_web_facts !== undefined && { auto_store_web_facts }),
    ...(natural_language_tool_router !== undefined && { natural_language_tool_router }),
    ...(retrieval_mode !== undefined && { retrieval_mode }),
  };
  cm.updateConfig({ agent_policy: newPolicy } as any);
  res.json({ success: true });
});

// ─── Model / Ollama Settings API ──────────────────────────────────────────────────

function getSessionDefaults() {
  return {
    maxMessages: 120,
    compactionThreshold: 0.7,
    memoryFlushThreshold: 0.75,
    rollingCompactionEnabled: true,
    rollingCompactionMessageCount: 20,
    rollingCompactionToolTurns: 5,
    rollingCompactionSummaryMaxWords: 220,
    rollingCompactionModel: '',
  };
}

function toBoundedInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toBoundedFloat(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

router.get('/api/settings/session', (_req, res) => {
  const cfg = (getConfig().getConfig() as any).session || {};
  const d = getSessionDefaults();
  res.json({
    success: true,
    session: {
      maxMessages: toBoundedInt(cfg.maxMessages, 20, 500, d.maxMessages),
      compactionThreshold: toBoundedFloat(cfg.compactionThreshold, 0.4, 0.95, d.compactionThreshold),
      memoryFlushThreshold: toBoundedFloat(cfg.memoryFlushThreshold, 0.5, 0.98, d.memoryFlushThreshold),
      rollingCompactionEnabled: cfg.rollingCompactionEnabled !== false,
      rollingCompactionMessageCount: toBoundedInt(cfg.rollingCompactionMessageCount, 10, 120, d.rollingCompactionMessageCount),
      rollingCompactionToolTurns: toBoundedInt(cfg.rollingCompactionToolTurns, 1, 12, d.rollingCompactionToolTurns),
      rollingCompactionSummaryMaxWords: toBoundedInt(cfg.rollingCompactionSummaryMaxWords, 80, 500, d.rollingCompactionSummaryMaxWords),
      rollingCompactionModel: String(cfg.rollingCompactionModel || '').trim(),
    },
  });
});

router.post('/api/settings/session', (req, res) => {
  try {
    const cm = getConfig();
    const current = cm.getConfig() as any;
    const existing = (current.session || {}) as Record<string, any>;
    const d = getSessionDefaults();
    const body = req.body || {};

    const nextSession = {
      ...existing,
      maxMessages: toBoundedInt(body.maxMessages ?? existing.maxMessages, 20, 500, d.maxMessages),
      compactionThreshold: toBoundedFloat(body.compactionThreshold ?? existing.compactionThreshold, 0.4, 0.95, d.compactionThreshold),
      memoryFlushThreshold: toBoundedFloat(body.memoryFlushThreshold ?? existing.memoryFlushThreshold, 0.5, 0.98, d.memoryFlushThreshold),
      rollingCompactionEnabled: body.rollingCompactionEnabled !== undefined
        ? !!body.rollingCompactionEnabled
        : (existing.rollingCompactionEnabled !== false),
      rollingCompactionMessageCount: toBoundedInt(
        body.rollingCompactionMessageCount ?? existing.rollingCompactionMessageCount,
        10,
        120,
        d.rollingCompactionMessageCount,
      ),
      rollingCompactionToolTurns: toBoundedInt(
        body.rollingCompactionToolTurns ?? existing.rollingCompactionToolTurns,
        1,
        12,
        d.rollingCompactionToolTurns,
      ),
      rollingCompactionSummaryMaxWords: toBoundedInt(
        body.rollingCompactionSummaryMaxWords ?? existing.rollingCompactionSummaryMaxWords,
        80,
        500,
        d.rollingCompactionSummaryMaxWords,
      ),
      rollingCompactionModel: String(body.rollingCompactionModel ?? existing.rollingCompactionModel ?? '').trim(),
    };

    cm.updateConfig({ session: nextSession } as any);
    res.json({ success: true, session: nextSession });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to save session settings' });
  }
});
router.get('/api/settings/model', (_req, res) => {
  const cfg = getConfig().getConfig();
  res.json({
    primary: cfg.models.primary,
    roles: cfg.models.roles,
    ollama_endpoint: (cfg as any).ollama?.endpoint || 'http://localhost:11434',
  });
});

router.post('/api/settings/model', (req, res) => {
  const { primary, roles, ollama_endpoint, provider, model } = req.body;
  const cm = getConfig();
  const current = cm.getConfig();

  // Provider+model switch from Telegram /model command (or web UI)
  if (provider && model) {
    const currentLlm = (current as any).llm || {};
    const currentProviders = currentLlm.providers || {};
    cm.updateConfig({
      llm: {
        ...currentLlm,
        provider,
        providers: {
          ...currentProviders,
          [provider]: { ...(currentProviders[provider] || {}), model },
        },
      },
      models: {
        primary: model,
        roles: { manager: model, executor: model, verifier: model },
      },
    } as any);
    res.json({ success: true, provider, model });
    return;
  }

  if (primary || roles) {
    cm.updateConfig({
      models: {
        primary: primary || current.models.primary,
        roles: { ...current.models.roles, ...(roles || {}) },
      }
    });
  }
  if (ollama_endpoint) {
    cm.updateConfig({
      ollama: { ...(current as any).ollama, endpoint: ollama_endpoint }
    } as any);
  }
  res.json({ success: true, model: getConfig().getConfig().models.primary });
});

// Fetch available Ollama models (proxies Ollama /api/tags)
router.get('/api/ollama/models', async (_req, res) => {
  try {
    const ollamaEndpoint = (getConfig().getConfig() as any).ollama?.endpoint || 'http://localhost:11434';
    const response = await fetch(`${ollamaEndpoint}/api/tags`);
    if (!response.ok) { res.json({ success: false, models: [], error: `Ollama returned ${response.status}` }); return; }
    const data = await response.json() as any;
    const models = (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size,
      parameter_size: m.details?.parameter_size || '',
      family: m.details?.family || '',
      modified_at: m.modified_at,
    }));
    res.json({ success: true, models });
  } catch (err: any) {
    res.json({ success: false, models: [], error: err.message });
  }
});

// ─── Agent Model Defaults API ─────────────────────────────────────────────────

const AGENT_MODEL_DEFAULT_KEYS = [
  'main_chat',
  'proposal_executor_high_risk',
  'proposal_executor_low_risk',
  'manager',
  'team_manager',
  'subagent',
  'team_subagent',
  'background_task',
  // Per-role-type subagent defaults
  'subagent_planner',
  'subagent_orchestrator',
  'subagent_researcher',
  'subagent_analyst',
  'subagent_builder',
  'subagent_operator',
  'subagent_verifier',
  'switch_model_low',
  'switch_model_medium',
  'coordinator',
  'background_agent',
] as const;

const HIDDEN_AGENT_MODEL_DEFAULT_KEYS = [
  'subagent',
  'team_manager',
  'team_subagent',
] as const;

// GET /api/settings/agent-model-defaults
// Returns the stored per-type defaults and the per-agent overrides for reference.
router.get('/api/settings/agent-model-defaults', (_req, res) => {
  const cfg = getConfig().getConfig() as any;
  res.json({
    success: true,
    defaults: cfg.agent_model_defaults || {},
    agents: (cfg.agents || []).map((a: any) => ({
      id:    a.id,
      name:  a.name,
      model: a.model || null,
    })),
  });
});

// POST /api/settings/agent-model-defaults
// Merges supplied fields into the stored defaults. Send only the keys you want to change.
// Send an empty string for a key to clear that default.
router.post('/api/settings/agent-model-defaults', (req, res) => {
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const incoming = req.body || {};
  const existing = current.agent_model_defaults || {};
  const patch: Record<string, string> = {};
  for (const key of AGENT_MODEL_DEFAULT_KEYS) {
    if (typeof incoming[key] === 'string') {
      const val = incoming[key].trim();
      // Empty string clears the key; non-empty sets it
      if (val) {
        patch[key] = val;
      } else {
        // explicitly clear — omit from merged object
        patch[key] = '';
      }
    }
  }
  // Merge: existing + patch (empty-string values are excluded from final object)
  const merged: Record<string, string> = { ...existing };
  for (const key of HIDDEN_AGENT_MODEL_DEFAULT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) delete merged[key];
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) merged[k] = v;
    else delete merged[k];
  }
  cm.updateConfig({ agent_model_defaults: merged } as any);
  res.json({ success: true, defaults: (cm.getConfig() as any).agent_model_defaults || {} });
});

// PATCH /api/agents/:id/model
// Update a specific agent definition's model override.
// Send { model: "" } to clear the override (agent falls back to type default or primary).
router.patch('/api/agents/:id/model', (req, res) => {
  const agentId = req.params.id;
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  if (!agentId) {
    res.status(400).json({ success: false, error: 'agent id required' });
    return;
  }
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const agents: any[] = Array.isArray(current.agents) ? [...current.agents] : [];
  const idx = agents.findIndex((a: any) => a.id === agentId);
  if (idx === -1) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
    return;
  }
  if (model) {
    agents[idx] = { ...agents[idx], model };
  } else {
    // Empty string = clear override so it falls back to type defaults
    const { model: _removed, ...rest } = agents[idx];
    agents[idx] = rest;
  }
  cm.updateConfig({ agents } as any);
  res.json({ success: true, agent: agents[idx] });
});

// ─── System Stats API ───────────────────────────────────────────────────────────

import * as osModule from 'os';

// Track previous CPU times for accurate utilization
let prevCpuTimes: { idle: number; total: number } | null = null;

function getCpuPercent(): number {
  const cpus = osModule.cpus();
  let totalIdle = 0; let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += (cpu.times as any)[type];
    totalIdle += cpu.times.idle;
  }
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  if (!prevCpuTimes) { prevCpuTimes = { idle, total }; return 0; }
  const idleDiff = idle - prevCpuTimes.idle;
  const totalDiff = total - prevCpuTimes.total;
  prevCpuTimes = { idle, total };
  if (totalDiff === 0) return 0;
  return Math.round(100 * (1 - idleDiff / totalDiff));
}

router.get('/api/system-stats', async (_req, res) => {
  const totalMem = osModule.totalmem();
  const freeMem = osModule.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = (usedMem / totalMem) * 100;
  const cpuPercent = getCpuPercent();
  const rss = process.memoryUsage().rss;

  // Check if Ollama is reachable
  let ollamaRunning = false;
  let ollamaMemMb = 0;
  let ollamaCount = 0;
  try {
    const ollamaEndpoint = (getConfig().getConfig() as any).ollama?.endpoint || 'http://localhost:11434';
    const r = await fetch(`${ollamaEndpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      ollamaRunning = true;
      const data = await r.json() as any;
      ollamaCount = (data.models || []).length;
    }
  } catch {}

  // GPU stats — use the cached detector (probed once at startup, never calls
  // nvidia-smi again). On non-NVIDIA systems this is instant and silent.
  const gpuInfo = detectGpu();
  let gpuStats = { available: false, gpu_util_percent: 0, vram_used_percent: 0, vram_used_gb: 0, vram_total_gb: 0, name: '' };
  if (gpuInfo.nvidiaAvailable) {
    // Re-query utilization metrics only when NVIDIA is confirmed present.
    // This is the *only* place nvidia-smi runs at runtime; startup detection
    // already verified the GPU exists so this call is guaranteed to succeed.
    try {
      const { execSync } = await import('child_process');
      const smiOut = execSync(
        'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
        { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const parts = smiOut.trim().split(',').map((s: string) => s.trim());
      if (parts.length >= 4) {
        const vramUsedMb = Number(parts[2]);
        const vramTotalMb = Number(parts[3]);
        gpuStats = {
          available: true,
          name: parts[0],
          gpu_util_percent: Number(parts[1]),
          vram_used_percent: vramTotalMb > 0 ? (vramUsedMb / vramTotalMb) * 100 : 0,
          vram_used_gb: vramUsedMb / 1024,
          vram_total_gb: vramTotalMb / 1024,
        };
      }
    } catch { /* nvidia-smi already confirmed working at startup; ignore transient errors */ }
  } else if (gpuInfo.amdAvailable) {
    gpuStats = { available: true, gpu_util_percent: 0, vram_used_percent: 0, vram_used_gb: 0, vram_total_gb: 0, name: gpuInfo.name ?? 'AMD GPU' };
  } else if (gpuInfo.appleSilicon) {
    gpuStats = { available: true, gpu_util_percent: 0, vram_used_percent: 0, vram_used_gb: 0, vram_total_gb: 0, name: gpuInfo.name ?? 'Apple Silicon' };
  }

  res.json({
    system: {
      cpu_percent: cpuPercent,
      memory_percent: memPercent,
      memory_used_gb: usedMem / (1024 ** 3),
      memory_total_gb: totalMem / (1024 ** 3),
    },
    gpu: gpuStats,
    ollama_process: { running: ollamaRunning, process_count: ollamaCount, total_memory_mb: ollamaMemMb },
    gateway_process: { rss_mb: rss / (1024 * 1024) },
    active_provider: (getConfig().getConfig() as any).llm?.provider || 'ollama',
    active_model: (() => { const c = getConfig().getConfig() as any; const p = c.llm?.provider || 'ollama'; return c.llm?.providers?.[p]?.model || c.models?.primary || 'unknown'; })(),
    timestamp: new Date().toISOString(),
  });
});

// Track agent mode per-session (simplified)
let useAgentMode = false;

// ─── Approvals API ───────────────────────────────────────────────────────────
// SECURITY: All approval endpoints require gateway auth. Approvals are the
// confirmation gate before the agent executes irreversible actions — an
// unauthenticated bypass here is a critical vulnerability.

// ─── Gateway Auth Middleware ──────────────────────────────────────────────────
// CRIT-03 / CRIT-01 fix: protects approval, memory-confirm, and open-path
// endpoints from unauthenticated access.
//
// Auth strategy (in priority order):
//   1. Bearer token in Authorization header  →  Authorization: Bearer <token>
//   2. X-Gateway-Token header                →  X-Gateway-Token: <token>
//   3. Localhost bypass (127.0.0.1 / ::1)    →  always trusted when no token configured
//
// Token is read from config at request time so it takes effect immediately
// after a config save without requiring a gateway restart.

router.get('/api/approvals', requireGatewayAuth, (req, res) => {
  const queue = getApprovalQueue();
  const status = String(req.query.status || 'pending').trim().toLowerCase();
  const taskId = String(req.query.taskId || '').trim();
  const approvals = (status === 'all'
    ? queue.listAll()
    : queue.listAll().filter((record) => record.status === status))
    .filter((record) => !taskId || String(record.taskId || '') === taskId)
    .map((record) => ({
      ...record,
      command: String(record.toolArgs?.command || ''),
      sourceSessionId: record.sessionId,
    }));
  res.json({ approvals });
});

function resolveApprovalRequest(req: any, res: any, decision: 'approved' | 'rejected' | undefined, resolvedBy: string) {
  const VALID_DECISIONS = ['approved', 'rejected'];
  const requestedDecision = decision || req.body?.decision;
  if (!requestedDecision || !VALID_DECISIONS.includes(requestedDecision)) {
    res.status(400).json({ success: false, error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` });
    return;
  }
  const queue = getApprovalQueue();
  const approval = queue.get(req.params.id);
  if (!approval) {
    res.status(404).json({ success: false, error: 'Approval not found' });
    return;
  }
  if (approval.status !== 'pending') {
    res.status(409).json({ success: false, error: `Approval already ${approval.status}` });
    return;
  }
  const resolved = queue.resolve(req.params.id, requestedDecision === 'approved', resolvedBy);
  if (!resolved) {
    res.status(409).json({ success: false, error: 'Approval could not be resolved' });
    return;
  }
  // Security audit: log every approval action (action name only, no payload)
  import('../../security/log-scrubber').then(({ log }) => {
    log.security('[approvals]', requestedDecision.toUpperCase(), 'approval-id:', req.params.id, 'action:', approval.action);
  }).catch(() => {});
  res.json({ success: true, decision: requestedDecision, approval: resolved });
}

router.post('/api/approvals/:id', requireGatewayAuth, (req, res) => {
  resolveApprovalRequest(req, res, req.body?.decision, 'web');
});

router.post('/api/approvals/:id/approve', requireGatewayAuth, (req, res) => {
  req.body = { ...(req.body || {}), decision: 'approved' };
  resolveApprovalRequest(req, res, 'approved', 'web');
});

router.post('/api/approvals/:id/deny', requireGatewayAuth, (req, res) => {
  req.body = { ...(req.body || {}), decision: 'rejected' };
  resolveApprovalRequest(req, res, 'rejected', 'web');
});

// ─── Memory API (stub) ───────────────────────────────────────────────────────────

router.post('/api/memory/confirm', requireGatewayAuth, (req, res) => {
  // Memory persistence stub — can be wired to ChromaDB/vector store
  // SECURITY: req.body is user/agent-supplied content — never log it raw.
  // scrubSecrets runs inside sanitizeToolLog before any write.
  import('../../security/log-scrubber').then(({ log, sanitizeToolLog }: any) => {
    log.info('[Memory]', sanitizeToolLog('confirm', req.body));
  }).catch(() => {});
  res.json({ ok: true });
});

// Open a file path in the OS file explorer
// SECURITY: This endpoint uses execFile() (not exec()) so the path is passed
// as an argument, not interpolated into a shell string. The path is also
// validated to be inside the workspace before execution.
router.post('/api/open-path', requireGatewayAuth, async (req, res) => {
  const fp = (req.body?.path || '') as string;
  if (!fp) { res.status(400).json({ ok: false, error: 'Path required' }); return; }

  // Resolve and validate against workspace, config dir, and configured
  // file allowlist so Settings > Security governs explorer access too.
  const resolvedFp = path.resolve(fp);
  const workspacePath = getConfig().getWorkspacePath();
  const configDirPath = getConfig().getConfigDir();
  const cfg = getConfig().getConfig() as any;
  const allowedPaths = Array.isArray(cfg?.tools?.permissions?.files?.allowed_paths)
    ? cfg.tools.permissions.files.allowed_paths
    : [];
  const isInWorkspace = isPathInside(workspacePath, resolvedFp);
  const isInConfigDir = isPathInside(configDirPath, resolvedFp);
  const isInAllowedPath = allowedPaths.some((allowed: string) => isPathInside(allowed, resolvedFp));
  if (!isInWorkspace && !isInConfigDir && !isInAllowedPath) {
    res.status(403).json({ ok: false, error: 'Path is outside allowed directories' });
    return;
  }

  try {
    const { execFile } = await import('child_process');
    // execFile passes args as a list — no shell interpolation possible
    if (process.platform === 'win32') {
      execFile('explorer.exe', [resolvedFp]);
    } else if (process.platform === 'darwin') {
      execFile('open', [resolvedFp]);
    } else {
      execFile('xdg-open', [resolvedFp]);
    }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// ─── Provider / Model Settings API ───────────────────────────────────────────
// Used by the Settings → Models tab to read/write provider config and
// trigger the OpenAI OAuth flow.

function sanitizeLLMConfig(llm: any): any {
  if (!llm || typeof llm !== 'object') return llm;
  const copy = JSON.parse(JSON.stringify(llm));
  const codexModel = copy?.providers?.openai_codex?.model;
  if (typeof codexModel === 'string' && codexModel.trim() === 'codex-davinci-002') {
    copy.providers.openai_codex.model = 'gpt-4o';
  }
  return copy;
}

function isMaskedSecretValue(value: any): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed === '••••••••' || /^[•]+$/.test(trimmed);
}

function preserveMaskedProviderSecrets(nextLlm: any, currentLlm: any): any {
  if (!nextLlm || typeof nextLlm !== 'object') return nextLlm;
  const out = JSON.parse(JSON.stringify(nextLlm));
  const nextProviders = out.providers || {};
  const currentProviders = (currentLlm && currentLlm.providers) || {};

  const secretPaths = listProviderSecretFieldPaths();

  for (const [providerId, field] of secretPaths) {
    const nextVal = nextProviders?.[providerId]?.[field];
    if (!isMaskedSecretValue(nextVal)) continue;
    const currentVal = currentProviders?.[providerId]?.[field];
    if (typeof currentVal === 'string') {
      out.providers = out.providers || {};
      out.providers[providerId] = out.providers[providerId] || {};
      out.providers[providerId][field] = currentVal;
    } else {
      delete out.providers?.[providerId]?.[field];
    }
  }

  return out;
}

// HIGH-02 fix: redact all api_key / token fields before sending to the UI.
// Vault references ("vault:...") and env references ("env:...") are also masked
// so neither the vault key name nor the env var name leaks to the browser.
const SENSITIVE_KEY_PATTERNS = /api[_-]?key|apikey|token|secret|password|passwd|credential/i;

function redactConfigForUI(obj: any, depth = 0): any {
  if (depth > 8 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => redactConfigForUI(v, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERNS.test(k) && typeof v === 'string' && v.length > 0) {
      out[k] = '••••••••';
    } else {
      out[k] = redactConfigForUI(v, depth + 1);
    }
  }
  return out;
}

// GET /api/settings/provider  — return active provider config (keys redacted)
router.get('/api/settings/provider', (_req, res) => {
  const raw = getConfig().getConfig() as any;
  const llmRaw = raw.llm || {
    provider: 'ollama',
    providers: { ollama: { endpoint: raw.ollama?.endpoint || 'http://localhost:11434', model: raw.models?.primary || 'qwen3:4b' } },
  };
  const llm = redactConfigForUI(sanitizeLLMConfig(llmRaw));
  res.json({ success: true, llm });
});

// POST /api/settings/provider  — update provider config
router.post('/api/settings/provider', (req, res) => {
  try {
    const llmIncoming = sanitizeLLMConfig(req.body?.llm);
    if (!llmIncoming?.provider) { res.status(400).json({ success: false, error: 'Missing llm.provider' }); return; }
    const configManager = getConfig();
    const current = (configManager.getConfig() as any).llm || {};
    const llm = preserveMaskedProviderSecrets(llmIncoming, current);
    const mergedLlm = {
      ...current,
      ...llm,
      providers: {
        ...(current.providers || {}),
        ...(llm.providers || {}),
      },
    };
    const activeModel = String(mergedLlm?.providers?.[mergedLlm.provider]?.model || '').trim();
    const legacyOllamaEndpoint = String(mergedLlm?.providers?.ollama?.endpoint || '').trim();
    const legacyModelSync = activeModel
      ? {
          models: {
            ...((configManager.getConfig() as any).models || {}),
            primary: activeModel,
            roles: { manager: activeModel, executor: activeModel, verifier: activeModel },
          },
        }
      : {};
    const legacyOllamaSync = legacyOllamaEndpoint
      ? {
          ollama: {
            ...((configManager.getConfig() as any).ollama || {}),
            endpoint: legacyOllamaEndpoint,
          },
        }
      : {};
    configManager.updateConfig({ llm: mergedLlm, ...legacyModelSync, ...legacyOllamaSync } as any);
    resetProvider();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/bulk  — save the main Settings modal in one atomic-ish
// config update. The UI previously fired six POSTs in parallel; every route
// rewrote config.json, so whichever response finished last could clobber parts
// of the others and each fetch had its own retry/timeout path.
router.post('/api/settings/bulk', (req, res) => {
  try {
    const body = req.body || {};
    const configManager = getConfig();
    const current = configManager.getConfig() as any;
    const updates: Record<string, any> = {};

    if (body.paths) {
      const workspacePath = typeof body.paths.workspace_path === 'string' ? body.paths.workspace_path.trim() : '';
      const normalizedAllowed = Array.from(new Set(
        [
          ...((Array.isArray(body.paths.allowed_paths) ? body.paths.allowed_paths : []).map((p: any) => String(p || '').trim()).filter(Boolean)),
          ...(workspacePath ? [workspacePath] : []),
        ].map((p) => path.resolve(p)),
      ));
      const normalizedBlocked = Array.from(new Set(
        (Array.isArray(body.paths.blocked_paths) ? body.paths.blocked_paths : [])
          .map((p: any) => String(p || '').trim())
          .filter(Boolean)
          .map((p: string) => path.resolve(p)),
      ));
      updates.tools = {
        ...current.tools,
        permissions: {
          ...current.tools?.permissions,
          files: {
            ...(current.tools?.permissions?.files || {}),
            allowed_paths: normalizedAllowed,
            blocked_paths: normalizedBlocked,
          },
        },
      };
      if (workspacePath) {
        try { fs.mkdirSync(workspacePath, { recursive: true }); } catch {}
        updates.workspace = { ...(current.workspace || {}), path: workspacePath };
      }
    }

    if (body.search) {
      const { preferred_provider, search_rigor, tavily_api_key, google_api_key, google_cx, brave_api_key } = body.search;
      const isNew = (v: any) => v !== undefined && v !== '' && v !== '••••••••';
      updates.search = {
        ...((current.search || {})),
        ...(preferred_provider !== undefined && { preferred_provider }),
        ...(search_rigor !== undefined && { search_rigor }),
        ...(isNew(tavily_api_key) && { tavily_api_key }),
        ...(isNew(google_api_key) && { google_api_key }),
        ...(google_cx !== undefined && { google_cx }),
        ...(isNew(brave_api_key) && { brave_api_key }),
      };
    }

    if (body.agent_policy) {
      const p = body.agent_policy;
      updates.agent_policy = {
        ...(current.agent_policy || {}),
        ...(p.force_web_for_fresh !== undefined && { force_web_for_fresh: p.force_web_for_fresh }),
        ...(p.memory_fallback_on_search_failure !== undefined && { memory_fallback_on_search_failure: p.memory_fallback_on_search_failure }),
        ...(p.auto_store_web_facts !== undefined && { auto_store_web_facts: p.auto_store_web_facts }),
        ...(p.natural_language_tool_router !== undefined && { natural_language_tool_router: p.natural_language_tool_router }),
        ...(p.retrieval_mode !== undefined && { retrieval_mode: p.retrieval_mode }),
      };
    }

    if (body.model) {
      const primary = body.model.primary || current.models?.primary;
      updates.models = {
        primary,
        roles: { ...(current.models?.roles || {}), ...(body.model.roles || {}) },
      };
      if (body.model.ollama_endpoint) {
        updates.ollama = { ...(current.ollama || {}), endpoint: body.model.ollama_endpoint };
      }
    }

    let providerChanged = false;
    if (body.llm) {
      const llmIncoming = sanitizeLLMConfig(body.llm);
      if (!llmIncoming?.provider) { res.status(400).json({ success: false, error: 'Missing llm.provider' }); return; }
      const currentLlm = current.llm || {};
      const llm = preserveMaskedProviderSecrets(llmIncoming, currentLlm);
      const mergedLlm = {
        ...currentLlm,
        ...llm,
        providers: {
          ...(currentLlm.providers || {}),
          ...(llm.providers || {}),
        },
      };
      updates.llm = mergedLlm;
      const activeModel = String(mergedLlm?.providers?.[mergedLlm.provider]?.model || '').trim();
      const legacyOllamaEndpoint = String(mergedLlm?.providers?.ollama?.endpoint || '').trim();
      if (activeModel) {
        updates.models = {
          ...((updates.models || current.models || {})),
          primary: activeModel,
          roles: { manager: activeModel, executor: activeModel, verifier: activeModel },
        };
      }
      if (legacyOllamaEndpoint) {
        updates.ollama = { ...((updates.ollama || current.ollama || {})), endpoint: legacyOllamaEndpoint };
      }
      providerChanged = true;
    }

    if (body.session) {
      const existing = (current.session || {}) as Record<string, any>;
      const d = getSessionDefaults();
      const s = body.session;
      updates.session = {
        ...existing,
        maxMessages: toBoundedInt(s.maxMessages ?? existing.maxMessages, 20, 500, d.maxMessages),
        compactionThreshold: toBoundedFloat(s.compactionThreshold ?? existing.compactionThreshold, 0.4, 0.95, d.compactionThreshold),
        memoryFlushThreshold: toBoundedFloat(s.memoryFlushThreshold ?? existing.memoryFlushThreshold, 0.5, 0.98, d.memoryFlushThreshold),
        rollingCompactionEnabled: s.rollingCompactionEnabled !== undefined ? !!s.rollingCompactionEnabled : (existing.rollingCompactionEnabled !== false),
        rollingCompactionMessageCount: toBoundedInt(s.rollingCompactionMessageCount ?? existing.rollingCompactionMessageCount, 10, 120, d.rollingCompactionMessageCount),
        rollingCompactionToolTurns: toBoundedInt(s.rollingCompactionToolTurns ?? existing.rollingCompactionToolTurns, 1, 12, d.rollingCompactionToolTurns),
        rollingCompactionSummaryMaxWords: toBoundedInt(s.rollingCompactionSummaryMaxWords ?? existing.rollingCompactionSummaryMaxWords, 80, 500, d.rollingCompactionSummaryMaxWords),
        rollingCompactionModel: String(s.rollingCompactionModel ?? existing.rollingCompactionModel ?? '').trim(),
      };
    }

    configManager.updateConfig(updates as any);
    if (providerChanged) resetProvider();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/models/test  — test connectivity for the active (or a given) provider
router.post('/api/models/test', async (req, res) => {
  try {
    const llmOverride = req.body?.llm ? sanitizeLLMConfig(req.body.llm) : null;
    const provider = llmOverride ? buildProviderForLLM(llmOverride) : getProvider();
    const ok = await provider.testConnection();
    const models = ok ? await provider.listModels() : [];
    res.json({ success: ok, models, error: ok ? undefined : 'Could not connect' });
  } catch (err: any) {
    res.json({ success: false, models: [], error: err.message });
  }
});

// GET /api/auth/openai/status  — is the user connected via OAuth?
router.get('/api/auth/openai/status', (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  const connected = isConnected(configDir);
  const tokens    = connected ? loadTokens(configDir) : null;
  res.json({ connected, account_id: tokens?.account_id || null, expires_at: tokens?.expires_at || null });
});

// POST /api/auth/openai/start  — start OAuth flow, return authUrl immediately (non-blocking)
// UI opens authUrl via window.open, then polls /api/auth/openai/poll for completion
router.post('/api/auth/openai/start', (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  try {
    const result = startOAuthFlowBackground(configDir);
    res.json(result); // { authUrl } or { error }
  } catch (err: any) {
    res.json({ error: err.message });
  }
});

// GET /api/auth/openai/poll  — check background OAuth completion
router.get('/api/auth/openai/poll', (_req, res) => {
  try {
    res.json(pollOAuthBackground());
  } catch (err: any) {
    res.json({ done: false, error: err.message });
  }
});

// POST /api/auth/openai/manual  — manual paste fallback token exchange
router.post('/api/auth/openai/manual', async (req, res) => {
  const configDir = CONFIG_DIR_PATH;
  const redirectedUrl = String(req.body?.url || '').trim();
  if (!redirectedUrl) {
    res.status(400).json({ success: false, error: 'Missing redirect URL' });
    return;
  }
  try {
    const result = await exchangeManualCodeFromPending(configDir, redirectedUrl);
    res.json(result);
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// POST /api/auth/openai/disconnect  — revoke stored tokens
router.post('/api/auth/openai/disconnect', (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  clearTokens(configDir);
  res.json({ success: true });
});

// ─── Anthropic Auth API ──────────────────────────────────────────────────────
// Uses the setup-token flow (same as OpenClaw):
//   1. User runs `claude setup-token` in their terminal
//   2. Pastes the token here
//   3. Token is stored encrypted in the vault
//   4. Used as Bearer auth for api.anthropic.com/v1/messages

// GET /api/auth/anthropic/status  — is the user connected?
router.get('/api/auth/anthropic/status', (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  const connected = anthropicIsConnected(configDir);
  const tokens    = connected ? anthropicLoadTokens(configDir) : null;
  res.json({
    connected,
    auth_type:  tokens?.auth_type || null,
    stored_at:  tokens?.stored_at || null,
    account_id: tokens?.account_id || null,
  });
});

// POST /api/auth/anthropic/setup-token  — paste a setup-token or API key
router.post('/api/auth/anthropic/setup-token', (req, res) => {
  const configDir = CONFIG_DIR_PATH;
  const token = String(req.body?.token || '').trim();
  if (!token) {
    res.status(400).json({ success: false, error: 'Missing token. Run `claude setup-token` and paste the result.' });
    return;
  }
  const result = anthropicStoreSetupToken(configDir, token);
  res.json(result);
});

// POST /api/auth/anthropic/disconnect  — clear stored tokens
router.post('/api/auth/anthropic/disconnect', (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  anthropicClearTokens(configDir);
  res.json({ success: true });
});

// POST /api/auth/anthropic/test  — verify the stored token works
router.post('/api/auth/anthropic/test', async (_req, res) => {
  const configDir = CONFIG_DIR_PATH;
  try {
    const { AnthropicAdapter } = require('../../providers/anthropic-adapter');
    const adapter = new AnthropicAdapter(configDir);
    const ok = await adapter.testConnection();
    res.json({ success: ok, error: ok ? undefined : 'Token rejected by Anthropic API. Re-run `claude setup-token` and paste a fresh token.' });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Webhook Settings API ────────────────────────────────────────────────────

router.get('/api/settings/hooks', (_req, res) => {
  const cfg = (getConfig().getConfig() as any).hooks || {};
  res.json({
    success: true,
    hooks: {
      enabled: cfg.enabled === true,
      token: cfg.token ? '••••••••' : '',           // never return the real token
      tokenSet: !!cfg.token,
      path: cfg.path || '/hooks',
    },
  });
});

router.post('/api/settings/hooks', (req, res) => {
  try {
    const { enabled, token, path: hookPath } = req.body || {};
    const current = (getConfig().getConfig() as any).hooks || {};
    const updated = {
      enabled: enabled === true,
      // If the user sent the masked placeholder, keep the existing token
      token: token && token !== '••••••••' ? String(token).trim() : (current.token || ''),
      path: hookPath ? String(hookPath).trim() : (current.path || '/hooks'),
    };
    getConfig().updateConfig({ hooks: updated } as any);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/settings/hooks/test', async (req, res) => {
  try {
    const cfg = (getConfig().getConfig() as any).hooks || {};
    if (!cfg.enabled) { res.json({ success: false, error: 'Webhooks are disabled' }); return; }
    if (!cfg.token)   { res.json({ success: false, error: 'No token configured' }); return; }
    res.json({ success: true, message: 'Webhook endpoint is active', path: cfg.path || '/hooks' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

