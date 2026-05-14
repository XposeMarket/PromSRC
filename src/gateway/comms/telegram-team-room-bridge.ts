import { getAgentById } from '../../config/config';
import { getManagedTeam } from '../teams/managed-teams';
import type { TelegramChannelConfig, TelegramTeamRoomConfig } from './broadcaster';

type PostTeamChat = (params: {
  teamId: string;
  message: string;
  fromName?: string;
  source?: string;
  targetType?: 'room' | 'team' | 'manager' | 'member';
  targetId?: string;
  targetLabel?: string;
  routedMessage?: string;
}) => Promise<{ success: boolean; message: any; target: any }>;

type TelegramRoomMessage = {
  accountId: string;
  agentId?: string;
  botUsername?: string;
  botId?: number;
  chatId: number;
  topicId?: number;
  messageId: number;
  text: string;
  fromId?: number;
  fromName?: string;
  fromUsername?: string;
  replyToBot?: boolean;
};

type SendOptions = { accountId?: string; agentId?: string; chatId: number; topicId?: number; text: string };

export class TelegramTeamRoomBridge {
  private config: TelegramChannelConfig;
  private readonly postTeamChat: PostTeamChat;
  private readonly sendMain: (chatId: number, text: string, topicId?: number) => Promise<void>;
  private readonly sendPersona: (opts: SendOptions) => Promise<boolean>;
  private readonly seenInbound = new Map<string, number>();
  private readonly seenOutbound = new Set<string>();

  constructor(config: TelegramChannelConfig, deps: {
    postTeamChat: PostTeamChat;
    sendMain: (chatId: number, text: string, topicId?: number) => Promise<void>;
    sendPersona: (opts: SendOptions) => Promise<boolean>;
  }) {
    this.config = config;
    this.postTeamChat = deps.postTeamChat;
    this.sendMain = deps.sendMain;
    this.sendPersona = deps.sendPersona;
  }

  updateConfig(config: TelegramChannelConfig): void {
    this.config = config;
  }

  getStatus(): { rooms: Array<TelegramTeamRoomConfig & { key: string; teamName: string | null }> } {
    return {
      rooms: Object.entries(this.config.teamRooms || {}).map(([key, room]) => ({
        ...room,
        key,
        teamName: getManagedTeam(room.teamId)?.name || null,
      })),
    };
  }

  async handleTelegramMessage(input: TelegramRoomMessage): Promise<boolean> {
    const room = this.resolveRoom(input.chatId, input.topicId);
    if (!room || room.enabled === false || !room.teamId) return false;
    const team = getManagedTeam(room.teamId);
    if (!team) return false;

    const text = String(input.text || '').trim();
    if (!text || text.startsWith('/')) return false;

    const dedupeKey = `${input.chatId}:${input.topicId || 0}:${input.messageId}`;
    if (this.seenInbound.has(dedupeKey)) return true;
    this.seenInbound.set(dedupeKey, Date.now());
    this.pruneSeenInbound();

    const botMention = input.botUsername ? new RegExp(`^@${this.escapeRegExp(input.botUsername)}\\b`, 'i') : null;
    const targetsPersona = Boolean(input.replyToBot || (botMention && botMention.test(text)));
    const routedText = input.botUsername
      ? text.replace(new RegExp(`^@${this.escapeRegExp(input.botUsername)}\\b[:,]?\\s*`, 'i'), '').trim()
      : text;
    const fromName = input.fromUsername
      ? `Telegram @${input.fromUsername}`
      : `Telegram ${input.fromName || input.fromId || 'user'}`;

    await this.postTeamChat({
      teamId: room.teamId,
      message: routedText || text,
      fromName,
      source: 'telegram_team_room',
      targetType: targetsPersona && input.agentId ? 'member' : undefined,
      targetId: targetsPersona && input.agentId ? input.agentId : undefined,
      targetLabel: targetsPersona && input.agentId ? (getAgentById(input.agentId) as any)?.name || input.agentId : undefined,
      routedMessage: targetsPersona ? (routedText || text) : undefined,
    });
    return true;
  }

  async handleTeamEvent(event: any): Promise<void> {
    const teamId = String(event?.teamId || '').trim();
    if (!teamId) return;
    const rooms = Object.values(this.config.teamRooms || {}).filter((room) => room.enabled !== false && room.teamId === teamId);
    if (rooms.length === 0) return;

    const formatted = this.formatTeamEvent(event);
    if (!formatted) return;
    const dedupeKey = this.outboundDedupeKey(event, formatted.text);
    if (this.seenOutbound.has(dedupeKey)) return;
    this.seenOutbound.add(dedupeKey);
    setTimeout(() => this.seenOutbound.delete(dedupeKey), 120000).unref?.();

    for (const room of rooms) {
      const sentByPersona = room.usePersonaIdentities !== false && formatted.agentId
        ? await this.sendPersona({ agentId: formatted.agentId, chatId: room.chatId, topicId: room.topicId, text: formatted.text })
        : false;
      if (!sentByPersona) {
        await this.sendMain(room.chatId, formatted.text, room.topicId);
      }
    }
  }

  private resolveRoom(chatId: number, topicId?: number): TelegramTeamRoomConfig | null {
    const rooms = this.config.teamRooms || {};
    if (topicId && rooms[`${chatId}:topic:${topicId}`]) return rooms[`${chatId}:topic:${topicId}`];
    if (rooms[String(chatId)]) return rooms[String(chatId)];
    return Object.values(rooms).find((room) =>
      room.enabled !== false
      && room.chatId === chatId
      && (!room.topicId || room.topicId === topicId)
    ) || null;
  }

  private formatTeamEvent(event: any): { text: string; agentId?: string } | null {
    const type = String(event?.type || '').trim();
    const teamName = String(event?.teamName || event?.teamId || '').trim();
    if (type === 'team_chat_message') {
      const msg = event.chatMessage || {};
      if (msg?.metadata?.source === 'telegram_team_room' && msg?.from === 'user') return null;
      const content = String(msg?.content || event?.text || '').trim();
      if (!content) return null;
      const fromName = String(msg?.fromName || msg?.from || 'Team').trim();
      const prefix = teamName ? `[${teamName}] ${fromName}` : fromName;
      return { text: `${prefix}:\n${content}`.slice(0, 3900), agentId: msg?.fromAgentId || msg?.metadata?.agentId };
    }
    if (type === 'team_dispatch') {
      const agentId = String(event?.agentId || '').trim();
      const task = String(event?.task || '').trim();
      return { text: `[${teamName}] Dispatch started -> ${agentId}${task ? `\n${task.slice(0, 1000)}` : ''}`, agentId };
    }
    if (type === 'team_dispatch_complete') {
      const agentId = String(event?.agentId || '').trim();
      const ok = event?.success === true;
      const preview = String(event?.resultPreview || '').trim();
      return { text: `[${teamName}] Dispatch ${ok ? 'complete' : 'failed'} -> ${agentId}${preview ? `\n${preview.slice(0, 1200)}` : ''}`, agentId };
    }
    if (type === 'team_change_proposed') {
      const change = event?.change || {};
      const description = String(change?.description || '').trim();
      return { text: `[${teamName}] Team change proposed${description ? `\n${description.slice(0, 1200)}` : ''}` };
    }
    if (type === 'team_manager_review_done') {
      return { text: `[${teamName}] Manager review complete.` };
    }
    return null;
  }

  private outboundDedupeKey(event: any, text: string): string {
    const msgId = event?.chatMessage?.id || event?.dispatchId || event?.taskId || '';
    return [event?.type, event?.teamId, msgId, text.slice(0, 80)].join(':');
  }

  private pruneSeenInbound(): void {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of this.seenInbound.entries()) {
      if (ts < cutoff) this.seenInbound.delete(key);
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
