import express from 'express';

import { getConfig } from '../../config/config';
import { getUsageCalibration } from '../../providers/model-usage';
import { captureChatTurnRouteSnapshot } from '../chat/chat-model-route';
import { buildContextWindowPressure } from '../context/context-window-pressure';
import { getSession } from '../session';
import { isSafeStorageId } from '../storage/storage-paths';

export const router = express.Router();

function resolveSessionCompactionThreshold(): number {
  try {
    const raw = Number((getConfig().getConfig() as any)?.session?.compactionThreshold);
    return Number.isFinite(raw) && raw >= 0.4 && raw <= 0.95 ? raw : 0.7;
  } catch {
    return 0.7;
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
    const pressure = buildContextWindowPressure({
      history: session.history,
      latestContextSummary: session.latestContextSummary,
      contextStartIndex: session.contextStartIndex,
      contextTokenEstimate: session.contextTokenEstimate,
      calibrationFactor: calibration.factor,
      contextWindowTokens: profile.contextWindowTokens,
      compactionThreshold: resolveSessionCompactionThreshold(),
    });

    res.json({
      success: true,
      sessionId,
      provider: snapshot.providerId,
      model: snapshot.model,
      ...pressure,
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
