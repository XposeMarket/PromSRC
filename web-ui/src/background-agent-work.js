// Compatibility entrypoint. New chat code should import from
// `features/chat/core/background-agent-work.js` directly.
export {
  BACKGROUND_AGENT_COLORS,
  BACKGROUND_AGENT_NAMES,
  backgroundAgentAgeLabel,
  backgroundAgentFollowUp,
  backgroundAgentFollowUpFields,
  backgroundAgentFollowUpLabel,
  backgroundAgentPreview,
  backgroundAgentText,
  backgroundAgentRecordToMessage,
  backgroundAgentWorkForSession,
  findBackgroundAgentWork,
  mergeBackgroundAgentEvents,
  mergeBackgroundAgentTraceEntries,
  mergeBackgroundAgentSteerMessages,
  normalizeBackgroundAgentWork,
  persistBackgroundAgentWork,
  readBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
  resolveBackgroundLaneIdentity,
  writeBackgroundAgentWork,
} from './features/chat/core/background-agent-work.js';
