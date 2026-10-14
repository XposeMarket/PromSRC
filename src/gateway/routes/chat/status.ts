import type { Router, RequestHandler } from 'express';
import { enqueuePostTurnJob, getPostTurnQueueStatus } from '../../chat/post-turn-queue';
import { getContextBuildLimiterStatus, runWithContextBuildPermit } from '../../chat/context-build-limiter';
import { getContextBuildWorkerPoolStatus } from '../../chat/context-build-worker-client';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../config/config';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { getMemoryIndexRefreshWorkerStatus, searchMemoryIndexAsync, readMemoryRecord } from '../../memory-index/index';
import { getMemorySearchWorkerStatus } from '../../memory-index/search-worker-client';
import { isProviderStatusChecking, markProviderStatus, readProviderStatusCache } from '../../provider-status';
import { getOrchestrationConfig } from './shared';



export function registerStatusRoutes(router: Router): void {
router.get('/api/status', async (_req, res) => {
  const rawCfg = getConfig().getConfig() as any;
  const provider: string = rawCfg.llm?.provider || 'ollama';
  const isCloudProvider = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
  const cachedProviderStatus = readProviderStatusCache();
  const connected = isCloudProvider ? true : !!cachedProviderStatus?.connected;
  const providerChecking = !isCloudProvider && !cachedProviderStatus && isProviderStatusChecking();
  const providerCfg = rawCfg.llm?.providers?.[provider] || {};
  const activeModel: string = providerCfg.model || rawCfg.models?.primary || 'unknown';
  const workspacePath = String(rawCfg.workspace?.path || getConfig().getWorkspacePath() || '').trim();
  const orchCfg = getOrchestrationConfig();
  res.json({
	    status: 'ok', version: 'v2-tools', ollama: connected, providerOnline: connected, providerChecking,
    provider,
    currentModel: activeModel,
    workspace: (getConfig().getConfig() as any).workspace?.path || '',
    search: rawCfg.search?.tinyfish_api_key ? 'tinyfish' : rawCfg.search?.google_api_key ? 'google' : (rawCfg.search?.tavily_api_key ? 'tavily' : 'none'),
    memory: {
      searchWorker: getMemorySearchWorkerStatus(),
      refreshWorker: getMemoryIndexRefreshWorkerStatus(),
    },
    orchestration: orchCfg ? {
      enabled: orchCfg.enabled,
      secondary: orchCfg.secondary,
    } : null,
    gatewayQueues: {
      contextBuild: getContextBuildLimiterStatus(),
      contextBuildWorkers: getContextBuildWorkerPoolStatus(),
      postTurn: getPostTurnQueueStatus(),
      sessionPersistence: getSessionPersistenceStatus(),
    },
  });
});
}

