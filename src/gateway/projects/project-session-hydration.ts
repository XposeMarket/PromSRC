// Project lists show each chat's current title, message count and preview.
// Those come from the session index: one small in-memory record per chat.
//
// The list used to load every project chat in full to read them. On a real
// install (139 project chats, 258 MB of history) that took 4.5 s per request
// with the event loop blocked, and the mobile app requests the project list
// every time a chat is opened.

export interface ProjectSessionSummaryLike {
  title?: string;
  preview?: string;
  messageCount?: number;
  createdAt?: number;
  lastActiveAt?: number;
  lastMessageAt?: number;
}

export type ProjectSessionSummaryLookup = (sessionId: string) => ProjectSessionSummaryLike | null | undefined;

const isPlaceholderTitle = (title: string): boolean => !title || /^new chat$/i.test(title);

/**
 * Overlay live chat facts onto a project's stored session rows. A row whose
 * chat is not in the index (no messages yet, or deleted) is returned as stored.
 */
export function hydrateProjectSessions(project: any, lookup: ProjectSessionSummaryLookup): any {
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  return {
    ...project,
    sessions: sessions.map((stored: any) => {
      try {
        const summary = lookup(String(stored?.id || ''));
        if (!summary) return stored;
        // Prefer the real chat title (auto-generated or user-renamed) so project
        // lists match the main chat list, then the stored title.
        const summaryTitle = String(summary.title || '').trim();
        const storedTitle = String(stored.title || '').trim();
        const title = !isPlaceholderTitle(summaryTitle)
          ? summaryTitle
          : !isPlaceholderTitle(storedTitle)
          ? storedTitle
          : 'New chat';
        return {
          ...stored,
          title,
          createdAt: summary.createdAt || stored.createdAt,
          updatedAt: summary.lastActiveAt || stored.updatedAt,
          messageCount: Number(summary.messageCount) || 0,
          preview: String(summary.preview || '').replace(/\s+/g, ' ').trim().slice(0, 240),
          lastMessageAt: Number(summary.lastMessageAt || summary.lastActiveAt || stored.updatedAt || 0) || undefined,
        };
      } catch {
        return stored;
      }
    }),
  };
}
