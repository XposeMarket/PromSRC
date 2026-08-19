// Compatibility entrypoint. New chat code should import from
// `features/chat/core/slash-commands.js` directly.
export {
  CHAT_COMPOSER_SUGGESTION_LIMIT,
  CHAT_SKILL_TRIGGER,
  getChatSlashCommands,
  isVisualSlashCommand,
  mergeSlashCommandSkillIds,
} from './features/chat/core/slash-commands.js';
