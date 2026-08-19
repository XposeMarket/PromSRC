// Compatibility entrypoint. New chat code should import from
// `features/chat/core/error-presentation.js` directly.
export {
  presentChatError,
  presentGoalAction,
} from './features/chat/core/error-presentation.js';
