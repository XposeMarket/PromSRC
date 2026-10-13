export let inferTaskChannelFromSession: any;
import { TelegramChannel } from '../../../comms/telegram-channel';
import { CronScheduler } from '../../../scheduling/cron-scheduler';
import { SkillsManager } from '../../../skills-runtime/skills-manager';
export let getMainChatStream: any;
export let handleChat: any;
export let runInteractiveTurn: any;
export let bindTeamNotificationTargetFromSession: any;


export let ROLLING_COMPACTION_SUMMARY_PREFIX: any;
export let LEGACY_COMPACTION_SUMMARY_PREFIX: any;
export let summarizeMobileRuntime: any;
export let _skillsManager: SkillsManager;
export let _cronScheduler: CronScheduler;
export let _telegramChannel: TelegramChannel;
export let router: any;
export let requireSafeSessionParam: any;
export let storageAwareStatus: any;
export function configureVoiceDependencies(deps: any) {
  inferTaskChannelFromSession = deps.inferTaskChannelFromSession;
  getMainChatStream = deps.getMainChatStream;
  handleChat = deps.handleChat;
  runInteractiveTurn = deps.runInteractiveTurn;
  bindTeamNotificationTargetFromSession = deps.bindTeamNotificationTargetFromSession;
  ROLLING_COMPACTION_SUMMARY_PREFIX = deps.ROLLING_COMPACTION_SUMMARY_PREFIX;
  LEGACY_COMPACTION_SUMMARY_PREFIX = deps.LEGACY_COMPACTION_SUMMARY_PREFIX;
  summarizeMobileRuntime = deps.summarizeMobileRuntime;
  handleChat = deps.handleChat;
  router = deps.router;
  requireSafeSessionParam = deps.requireSafeSessionParam;
  storageAwareStatus = deps.storageAwareStatus;
}

export function configureVoiceSingletons(deps: any) {
  _skillsManager = deps.skillsManager;
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
}
