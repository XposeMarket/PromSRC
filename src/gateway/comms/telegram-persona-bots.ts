import { getAgentById } from '../../config/config';
import type { TelegramChannelConfig, TelegramPersonaConfig } from './broadcaster';
import type { TelegramTeamRoomBridge } from './telegram-team-room-bridge';

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel' | string;
  title?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  my_chat_member?: {
    chat: TelegramChat;
    from?: TelegramUser;
    old_chat_member?: { status?: string; user?: TelegramUser };
    new_chat_member?: { status?: string; user?: TelegramUser };
  };
  managed_bot?: {
    user?: TelegramUser;
    bot?: TelegramUser;
  };
};

type BotInfo = TelegramUser & {
  first_name: string;
  username: string;
  can_manage_bots?: boolean;
};

type RunSubagentTurn = (params: {
  agentId: string;
  message: string;
  source: string;
  accountId?: string;
  peerId?: string;
  userLabel?: string;
  timeoutMs?: number;
  sessionId?: string;
  seedFromSharedChatStore?: boolean;
}) => Promise<{ result: { text?: string } }>;

type PersonaRuntime = {
  accountId: string;
  config: TelegramPersonaConfig;
  token: string;
  inheritedAllowedUserIds: number[];
  managerToken?: string;
  botInfo: BotInfo | null;
  polling: boolean;
  abortController: AbortController | null;
  offset: number;
  loop?: Promise<void>;
  lastError?: string;
};

export class TelegramPersonaBotManager {
  private config: TelegramChannelConfig;
  private readonly runSubagentTurn: RunSubagentTurn;
  private readonly runtimes = new Map<string, PersonaRuntime>();
  private teamRoomBridge: TelegramTeamRoomBridge | null = null;

  constructor(config: TelegramChannelConfig, deps: { runSubagentTurn: RunSubagentTurn }) {
    this.config = config;
    this.runSubagentTurn = deps.runSubagentTurn;
  }

  async start(): Promise<void> {
    await this.restart();
  }

  async stop(): Promise<void> {
    const runtimes = Array.from(this.runtimes.values());
    this.runtimes.clear();
    for (const runtime of runtimes) {
      runtime.polling = false;
      runtime.abortController?.abort();
      runtime.abortController = null;
    }
    await Promise.allSettled(runtimes.map((runtime) => runtime.loop).filter(Boolean) as Promise<void>[]);
  }

  async updateConfig(config: TelegramChannelConfig): Promise<void> {
    this.config = config;
    await this.restart();
  }

  setTeamRoomBridge(bridge: TelegramTeamRoomBridge | null): void {
    this.teamRoomBridge = bridge;
  }

  getStatus(): {
    enabled: boolean;
    accounts: Array<{
      accountId: string;
      agentId: string;
      connected: boolean;
      polling: boolean;
      username: string | null;
      firstName: string | null;
      hasToken: boolean;
      managedBotUserId?: number;
      groupChatIds: number[];
      addToGroupUrl: string | null;
      lastError?: string;
    }>;
  } {
    const accounts = Array.from(this.runtimes.values()).map((runtime) => {
      const username = runtime.botInfo?.username || runtime.config.botUsername || null;
      return {
        accountId: runtime.accountId,
        agentId: runtime.config.agentId,
        connected: !!runtime.botInfo,
        polling: runtime.polling,
        username,
        firstName: runtime.botInfo?.first_name || null,
        hasToken: !!runtime.token,
        managedBotUserId: runtime.config.managedBotUserId,
        groupChatIds: runtime.config.groupChatIds || [],
        addToGroupUrl: username ? `https://t.me/${encodeURIComponent(username)}?startgroup=${encodeURIComponent(runtime.accountId)}` : null,
        lastError: runtime.lastError,
      };
    });
    const configuredOnly = Object.entries(this.config.personas || {})
      .filter(([accountId]) => !this.runtimes.has(accountId))
      .map(([accountId, persona]) => ({
        accountId,
        agentId: persona.agentId,
        connected: false,
        polling: false,
        username: persona.botUsername || null,
        firstName: null,
        hasToken: !!persona.botToken || !!persona.managedBotUserId,
        managedBotUserId: persona.managedBotUserId,
        groupChatIds: persona.groupChatIds || [],
        addToGroupUrl: persona.botUsername ? `https://t.me/${encodeURIComponent(persona.botUsername)}?startgroup=${encodeURIComponent(accountId)}` : null,
        lastError: persona.enabled === false ? 'disabled' : 'not started',
      }));
    return {
      enabled: this.config.enabled,
      accounts: [...accounts, ...configuredOnly],
    };
  }

  async testAccount(accountId: string, override?: Partial<TelegramPersonaConfig>): Promise<{ success: boolean; bot?: any; error?: string }> {
    const configured = this.config.personas?.[accountId];
    if (!configured && !override) return { success: false, error: `Telegram persona account "${accountId}" is not configured` };
    const persona = this.normalizePersona(accountId, { ...(configured || {}), ...(override || {}) });
    try {
      const token = await this.resolvePersonaToken(persona);
      if (!token) return { success: false, error: 'No bot token or managedBotUserId configured' };
      const bot = await this.apiCall(token, 'getMe') as BotInfo;
      return { success: true, bot: { id: bot.id, username: bot.username, firstName: bot.first_name } };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  }

  async sendMessageForAccount(accountId: string, chatId: number, text: string, messageThreadId?: number): Promise<boolean> {
    const runtime = this.runtimes.get(accountId);
    if (!runtime?.token) return false;
    await this.sendMessage(runtime, chatId, text, messageThreadId);
    return true;
  }

  async sendMessageForAgent(agentId: string, chatId: number, text: string, messageThreadId?: number): Promise<boolean> {
    const cleanAgentId = String(agentId || '').trim();
    for (const runtime of this.runtimes.values()) {
      if (runtime.config.agentId !== cleanAgentId) continue;
      if (!runtime.token) continue;
      await this.sendMessage(runtime, chatId, text, messageThreadId);
      return true;
    }
    return false;
  }

  private async restart(): Promise<void> {
    await this.stop();
    if (!this.config.enabled) {
      console.log('[TelegramPersonaBots] Disabled by channels.telegram.enabled');
      return;
    }

    for (const [accountId, rawPersona] of Object.entries(this.config.personas || {})) {
      const persona = this.normalizePersona(accountId, rawPersona);
      if (persona.enabled === false) continue;
      if (!persona.agentId) {
        console.warn(`[TelegramPersonaBots] ${accountId}: missing agentId`);
        continue;
      }
      if (!getAgentById(persona.agentId)) {
        console.warn(`[TelegramPersonaBots] ${accountId}: agent "${persona.agentId}" was not found`);
        continue;
      }

      const runtime: PersonaRuntime = {
        accountId,
        config: persona,
        token: '',
        inheritedAllowedUserIds: this.config.allowedUserIds || [],
        managerToken: this.config.botToken || undefined,
        botInfo: null,
        polling: false,
        abortController: null,
        offset: 0,
      };
      this.runtimes.set(accountId, runtime);
      runtime.loop = this.startRuntime(runtime);
    }
  }

  private normalizePersona(accountId: string, raw: Partial<TelegramPersonaConfig>): TelegramPersonaConfig {
    return {
      enabled: raw.enabled !== false,
      agentId: String(raw.agentId || accountId).trim(),
      botToken: String(raw.botToken || '').trim(),
      managedBotUserId: Number.isFinite(Number(raw.managedBotUserId)) && Number(raw.managedBotUserId) > 0
        ? Number(raw.managedBotUserId)
        : undefined,
      botUsername: raw.botUsername ? String(raw.botUsername).replace(/^@/, '').trim() : undefined,
      allowedUserIds: Array.isArray(raw.allowedUserIds) ? raw.allowedUserIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [],
      groupChatIds: Array.isArray(raw.groupChatIds) ? raw.groupChatIds.map(Number).filter((n) => Number.isFinite(n) && n !== 0) : [],
      requireMentionInGroups: raw.requireMentionInGroups !== false,
      streamMode: raw.streamMode === 'partial' ? 'partial' : 'full',
    };
  }

  private async startRuntime(runtime: PersonaRuntime): Promise<void> {
    try {
      runtime.token = await this.resolvePersonaToken(runtime.config);
      if (!runtime.token) {
        runtime.lastError = 'No bot token or managedBotUserId configured';
        console.warn(`[TelegramPersonaBots] ${runtime.accountId}: ${runtime.lastError}`);
        return;
      }

      runtime.botInfo = await this.apiCall(runtime.token, 'getMe') as BotInfo;
      runtime.config.botUsername = runtime.botInfo.username;
      runtime.polling = true;
      runtime.abortController = new AbortController();
      await this.registerCommands(runtime);
      console.log(`[TelegramPersonaBots] ${runtime.accountId} -> ${runtime.config.agentId} connected as @${runtime.botInfo.username}`);
      await this.pollLoop(runtime);
    } catch (err: any) {
      runtime.lastError = String(err?.message || err);
      runtime.polling = false;
      console.error(`[TelegramPersonaBots] ${runtime.accountId}: ${runtime.lastError}`);
    }
  }

  private async resolvePersonaToken(persona: TelegramPersonaConfig): Promise<string> {
    if (persona.botToken) return persona.botToken;
    if (!persona.managedBotUserId) return '';
    if (!this.config.botToken) {
      throw new Error('managedBotUserId requires channels.telegram.botToken to be the manager bot token');
    }
    return String(await this.apiCall(this.config.botToken, 'getManagedBotToken', { user_id: persona.managedBotUserId }));
  }

  private async registerCommands(runtime: PersonaRuntime): Promise<void> {
    await this.apiCall(runtime.token, 'setMyCommands', {
      commands: [
        { command: 'start', description: 'Open this agent chat' },
        { command: 'status', description: 'Show bot and agent status' },
        { command: 'whereami', description: 'Show chat IDs for setup' },
        { command: 'help', description: 'Show setup help' },
      ],
    }).catch((err: any) => {
      console.warn(`[TelegramPersonaBots] ${runtime.accountId}: setMyCommands failed: ${String(err?.message || err)}`);
    });
  }

  private async pollLoop(runtime: PersonaRuntime): Promise<void> {
    while (runtime.polling) {
      try {
        const updates = await this.apiCall(runtime.token, 'getUpdates', {
          offset: runtime.offset || undefined,
          timeout: 25,
          limit: 50,
          allowed_updates: ['message', 'edited_message', 'my_chat_member', 'managed_bot'],
        }, runtime.abortController?.signal) as TelegramUpdate[];
        for (const update of updates || []) {
          runtime.offset = Math.max(runtime.offset, update.update_id + 1);
          await this.handleUpdate(runtime, update);
        }
      } catch (err: any) {
        if (!runtime.polling) break;
        runtime.lastError = String(err?.message || err);
        console.warn(`[TelegramPersonaBots] ${runtime.accountId}: polling error: ${runtime.lastError}`);
        await this.sleep(2500);
      }
    }
  }

  private async handleUpdate(runtime: PersonaRuntime, update: TelegramUpdate): Promise<void> {
    if (update.my_chat_member) {
      await this.handleChatMemberUpdate(runtime, update.my_chat_member);
      return;
    }
    if (update.managed_bot) {
      const bot = update.managed_bot.bot || update.managed_bot.user;
      if (bot) {
        console.log(`[TelegramPersonaBots] Managed bot update: ${bot.username || bot.id}`);
      }
      return;
    }

    const message = update.message || update.edited_message;
    if (!message) return;
    await this.handleMessage(runtime, message);
  }

  private async handleChatMemberUpdate(runtime: PersonaRuntime, event: NonNullable<TelegramUpdate['my_chat_member']>): Promise<void> {
    const status = String(event.new_chat_member?.status || '');
    if (event.chat.type !== 'group' && event.chat.type !== 'supergroup') return;
    if (status !== 'member' && status !== 'administrator') return;
    await this.sendMessage(runtime, event.chat.id, [
      `Connected ${runtime.accountId} to ${runtime.config.agentId}.`,
      `Chat ID: ${event.chat.id}`,
      'Add that ID to channels.telegram.personas.' + runtime.accountId + '.groupChatIds to let this bot answer here.',
    ].join('\n'));
  }

  private async handleMessage(runtime: PersonaRuntime, message: TelegramMessage): Promise<void> {
    const rawText = String(message.text || message.caption || '').trim();
    if (!rawText) return;
    if (message.from?.is_bot) return;
    const chatType = String(message.chat.type || '');
    const chatId = Number(message.chat.id);
    const fromId = Number(message.from?.id || 0);
    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const command = rawText.startsWith('/') ? rawText.split(/\s+/, 1)[0].replace(/@.+$/, '').toLowerCase() : '';

    if (command === '/whereami') {
      await this.sendWhereAmI(runtime, message);
      return;
    }
    if (command === '/start' || command === '/help') {
      await this.sendHelp(runtime, message);
      return;
    }
    if (command === '/status') {
      await this.sendMessage(runtime, chatId, [
        `Account: ${runtime.accountId}`,
        `Agent: ${runtime.config.agentId}`,
        `Bot: @${runtime.botInfo?.username || runtime.config.botUsername || 'unknown'}`,
        `Chat: ${chatId}${message.message_thread_id ? ` topic ${message.message_thread_id}` : ''}`,
      ].join('\n'), message.message_thread_id);
      return;
    }

    if (!this.isAllowedUser(runtime, fromId)) {
      if (isPrivate) {
        await this.sendMessage(runtime, chatId, `User ${fromId || 'unknown'} is not in allowedUserIds for ${runtime.accountId}. Use /whereami to copy your ID.`, message.message_thread_id);
      }
      return;
    }

    if (isGroup && !this.isAllowedGroup(runtime, chatId)) {
      if (this.isMentioned(runtime, message, rawText)) {
        await this.sendMessage(runtime, chatId, `Group ${chatId} is not configured for ${runtime.accountId}. Use /whereami and add it to groupChatIds.`, message.message_thread_id);
      }
      return;
    }

    if (isGroup && this.teamRoomBridge) {
      const bridged = await this.teamRoomBridge.handleTelegramMessage({
        accountId: runtime.accountId,
        agentId: runtime.config.agentId,
        botUsername: runtime.botInfo?.username || runtime.config.botUsername,
        botId: runtime.botInfo?.id,
        chatId,
        topicId: message.message_thread_id,
        messageId: message.message_id,
        text: rawText,
        fromId,
        fromName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' '),
        fromUsername: message.from?.username,
        replyToBot: !!message.reply_to_message?.from?.is_bot && message.reply_to_message?.from?.id === runtime.botInfo?.id,
      });
      if (bridged) return;
    }

    if (isGroup && runtime.config.requireMentionInGroups && !this.isMentioned(runtime, message, rawText)) {
      return;
    }

    const text = this.stripCommandTarget(runtime, rawText).trim();
    if (!text || text.startsWith('/')) return;

    const peerId = [
      isPrivate ? `user:${fromId || chatId}` : `group:${chatId}`,
      message.message_thread_id ? `topic:${message.message_thread_id}` : '',
    ].filter(Boolean).join(':');
    const label = [
      message.from?.username ? `@${message.from.username}` : [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Telegram user',
      isGroup ? `in ${message.chat.title || chatId}` : '',
    ].filter(Boolean).join(' ');

    try {
      await this.sendChatAction(runtime, chatId, 'typing', message.message_thread_id);
      const payload = await this.runSubagentTurn({
        agentId: runtime.config.agentId,
        message: text,
        source: 'telegram_persona',
        accountId: runtime.accountId,
        peerId,
        userLabel: label,
        sessionId: this.sessionId(runtime, peerId),
        seedFromSharedChatStore: true,
      });
      const reply = String(payload.result?.text || '').trim() || '(No response text returned.)';
      await this.sendMessage(runtime, chatId, reply, message.message_thread_id);
    } catch (err: any) {
      await this.sendMessage(runtime, chatId, `Agent error: ${String(err?.message || err)}`, message.message_thread_id);
    }
  }

  private async sendWhereAmI(runtime: PersonaRuntime, message: TelegramMessage): Promise<void> {
    const lines = [
      `accountId: ${runtime.accountId}`,
      `agentId: ${runtime.config.agentId}`,
      `chatId: ${message.chat.id}`,
      `chatType: ${message.chat.type}`,
      message.chat.title ? `chatTitle: ${message.chat.title}` : '',
      message.message_thread_id ? `topicId: ${message.message_thread_id}` : '',
      message.from?.id ? `userId: ${message.from.id}` : '',
      runtime.botInfo?.username ? `bot: @${runtime.botInfo.username}` : '',
    ].filter(Boolean);
    await this.sendMessage(runtime, message.chat.id, lines.join('\n'), message.message_thread_id);
  }

  private async sendHelp(runtime: PersonaRuntime, message: TelegramMessage): Promise<void> {
    const username = runtime.botInfo?.username || runtime.config.botUsername || '';
    const addToGroupUrl = username ? `https://t.me/${username}?startgroup=${encodeURIComponent(runtime.accountId)}` : '';
    const lines = [
      `This bot routes messages to Prometheus agent ${runtime.config.agentId}.`,
      'Private chat: send a message directly.',
      'Group chat: add the bot, run /whereami, then put the chatId in groupChatIds.',
      addToGroupUrl ? `Add to group: ${addToGroupUrl}` : '',
    ].filter(Boolean);
    await this.sendMessage(runtime, message.chat.id, lines.join('\n'), message.message_thread_id);
  }

  private isAllowedUser(runtime: PersonaRuntime, userId: number): boolean {
    if (!Number.isFinite(userId) || userId <= 0) return false;
    const personaAllowed = runtime.config.allowedUserIds || [];
    const allowed = personaAllowed.length > 0 ? personaAllowed : runtime.inheritedAllowedUserIds;
    return allowed.includes(userId);
  }

  private isAllowedGroup(runtime: PersonaRuntime, chatId: number): boolean {
    const groups = runtime.config.groupChatIds || [];
    return groups.length > 0 && groups.includes(chatId);
  }

  private isMentioned(runtime: PersonaRuntime, message: TelegramMessage, text: string): boolean {
    const username = runtime.botInfo?.username || runtime.config.botUsername || '';
    const mentioned = username ? new RegExp(`@${this.escapeRegExp(username)}\\b`, 'i').test(text) : false;
    const repliedToBot = !!message.reply_to_message?.from?.is_bot && message.reply_to_message?.from?.id === runtime.botInfo?.id;
    return mentioned || repliedToBot;
  }

  private stripCommandTarget(runtime: PersonaRuntime, text: string): string {
    const username = runtime.botInfo?.username || runtime.config.botUsername || '';
    if (!username) return text;
    return text.replace(new RegExp(`@${this.escapeRegExp(username)}\\b`, 'ig'), '').trim();
  }

  private sessionId(runtime: PersonaRuntime, peerId: string): string {
    return ['telegram_persona', runtime.accountId, runtime.config.agentId, peerId]
      .join('_')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 180);
  }

  private async sendMessage(runtime: PersonaRuntime, chatId: number, text: string, messageThreadId?: number): Promise<void> {
    const chunks = this.chunkText(String(text || '').trim() || ' ');
    for (const chunk of chunks) {
      await this.apiCall(runtime.token, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        message_thread_id: messageThreadId || undefined,
        disable_web_page_preview: true,
      });
    }
  }

  private async sendChatAction(runtime: PersonaRuntime, chatId: number, action: string, messageThreadId?: number): Promise<void> {
    await this.apiCall(runtime.token, 'sendChatAction', {
      chat_id: chatId,
      action,
      message_thread_id: messageThreadId || undefined,
    }).catch(() => {});
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 3900) {
      chunks.push(remaining.slice(0, 3900));
      remaining = remaining.slice(3900);
    }
    chunks.push(remaining);
    return chunks;
  }

  private async apiCall(token: string, method: string, body?: object, signal?: AbortSignal): Promise<any> {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description || resp.statusText || 'unknown error'}`);
    return data.result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms) as any;
      if (typeof timer?.unref === 'function') timer.unref();
    });
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
