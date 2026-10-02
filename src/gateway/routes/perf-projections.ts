import { createHash } from 'node:crypto';

/** Explicit wire projection: new internal summary metadata must not silently inflate drawer loads. */
export function slimSessionList<T extends { sessions: Record<string, any>[] }>(page: T): T {
  return { ...page, sessions: page.sessions.map((session) => {
    const { id, title, createdAt, lastActiveAt, lastMessageAt, lastAssistantAt,
      pinnedAt, sidebarOrder, settledAt, settled, mobileLastReadAt, mobileUnread,
      activeRun, channel, preview, messageCount, creativeMode,
      canvasProjectRoot, canvasProjectLabel, canvasProjectLink, chatModelRoute,
      projectId, projectName, project, mainChatGoal, voiceRoom, externalImport } = session;
    return { id, title, createdAt, lastActiveAt, lastMessageAt, lastAssistantAt,
      pinnedAt, sidebarOrder, settledAt, settled, mobileLastReadAt, mobileUnread,
      activeRun, channel, preview: String(preview || '').slice(0, 160), messageCount,
      creativeMode, canvasProjectRoot, canvasProjectLabel, canvasProjectLink,
      chatModelRoute: chatModelRoute ? { model: chatModelRoute.model, providerId: chatModelRoute.providerId,
        effective: chatModelRoute.effective ? { providerId: chatModelRoute.effective.providerId } : undefined } : undefined,
      projectId, projectName, project,
      mainChatGoal: mainChatGoal ? { status: mainChatGoal.status } : null,
      voiceRoom: voiceRoom ? { status: voiceRoom.status } : null,
      externalImport: externalImport ? { source: externalImport.source && {
        provider: externalImport.source.provider, adapter: externalImport.source.adapter,
        sourceLabel: externalImport.source.sourceLabel } } : undefined };
  }) };
}

export function slimSkillList(skills: Record<string, any>[]): Record<string, any>[] {
  return skills.map(({ id, name, description, categories, kind, status, lifecycle, version, eligible, resources }) => ({
    id, name, description: String(description || '').slice(0, 200), categories, kind, status, lifecycle, version, eligible,
    resourceCount: Array.isArray(resources) ? resources.length : 0,
  }));
}

/** Hash serialized wire data (not internal state) to make conditional GETs reliable. */
export function responseEtag(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 24)}"`;
}
