import express from 'express';

import { getConfig } from '../../config/config';
import { resolveCompactionThreshold } from '../context/model-context';
import { getUsageCalibration } from '../../providers/model-usage';
import { captureChatTurnRouteSnapshot } from '../chat/chat-model-route';
import { buildContextWindowPressure } from '../context/context-window-pressure';
import { getSession } from '../session';
import { getCompactionRequestPressure } from '../context/compaction-pressure';
import { isSafeStorageId } from '../storage/storage-paths';

export const router = express.Router();

function resolveSessionCompactionThreshold(): number | 'auto' {
  try {
    return resolveCompactionThreshold((getConfig().getConfig() as any)?.session?.compactionThreshold, (getConfig().getConfig() as any)?.session?.compactionThresholdMode);
  } catch {
    return 'auto';
  }
}

/**
 * Exposes the same active-transcript pressure that the session pre-turn
 * compaction gate evaluates. This intentionally complements (rather than
 * replaces) /api/sessions/:id/context-window, whose rows describe the bounded
 * next model-call slice.
 */
router.get('/api/sessions/:id/context-pressure', (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId || !isSafeStorageId(sessionId)) {
      res.status(400).json({ success: false, error: 'Invalid session id' });
      return;
    }

    const session = getSession(sessionId);
    const { snapshot } = captureChatTurnRouteSnapshot(sessionId);
    const profile = snapshot.contextProfile;
    const budget = snapshot.contextBudget;
    const calibration = getUsageCalibration(snapshot.providerId, snapshot.model);
    const assembledRequestTokens = getCompactionRequestPressure(sessionId, session, {
      providerId: profile.providerId, model: profile.model,
      contextWindowTokens: profile.contextWindowTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionTriggerTokens: budget.compactionTriggerTokens,
    });
    const pressure = buildContextWindowPressure({
      assembledRequestTokens,
      history: session.history,
      latestContextSummary: session.latestContextSummary,
      contextStartIndex: session.contextStartIndex,
      contextTokenEstimate: session.contextTokenEstimate,
      calibrationFactor: calibration.factor,
      contextWindowTokens: profile.contextWindowTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionThreshold: resolveSessionCompactionThreshold(),
      compactionThresholdMode: 'manual',
    });

    res.json({
      success: true,
      sessionId,
      provider: snapshot.providerId,
      model: snapshot.model,
      ...pressure,
      assembledRequestTokens,
      pressureSource: assembledRequestTokens === undefined ? 'active_transcript' : 'active_transcript_and_request',
      standardContextWindowTokens: profile.standardContextWindowTokens,
      maxContextWindowTokens: profile.maxContextWindowTokens,
      contextSelectionMode: profile.contextSelectionMode,
      contextUsageWarning: profile.contextUsageWarning,
      pendingCompaction: session.pendingCompaction === true,
      inputBudgetTokens: budget.inputBudgetTokens,
      midWorkflowCompactionTriggerTokens: budget.compactionTriggerTokens,
      toolContextBudgetTokens: budget.toolContextBudgetTokens,
      // The first pressure gate that can cause a compaction event. The UI can
      // explain why compaction starts before the provider's hard window fills.
      effectiveCompactionTriggerTokens: Math.min(
        pressure.compactionTriggerTokens || Number.MAX_SAFE_INTEGER,
        budget.compactionTriggerTokens || Number.MAX_SAFE_INTEGER,
      ),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: String(error?.message || error || 'Failed to compute context pressure') });
  }
});
