// Compatibility entrypoint. New chat code should import from
// `features/chat/core/background-agent-work.js` directly.
export {
  BACKGROUND_AGENT_COLORS,
  BACKGROUND_AGENT_NAMES,
  backgroundAgentAgeLabel,
  backgroundAgentPreview,
  backgroundAgentRecordToMessage,
  backgroundAgentWorkForSession,
  appendBackgroundAgentEvent,
  flushBackgroundAgentWorkPersistence,
  findBackgroundAgentWork,
  mergeBackgroundAgentEvents,
  mergeBackgroundAgentTraceEntries,
  normalizeBackgroundAgentWork,
  persistBackgroundAgentWork,
  readBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
  writeBackgroundAgentWork,
} from './features/chat/core/background-agent-work.js';
