import { resolveBrowserObserveMode } from '../../../browser-tools';
import { isBrowserToolName } from '../../../chat/chat-helpers';

export const isExplicitLowOverheadBrowserObserve = (
    toolName: string,
    toolArgs: Record<string, any> = {},
  ): boolean => {
    if (!isBrowserToolName(toolName)) return false;
    if (!Object.prototype.hasOwnProperty.call(toolArgs || {}, 'observe')) return false;
    const mode = resolveBrowserObserveMode(toolName, toolArgs?.observe);
    return mode === 'none' || mode === 'compact';
  };

export const feedItemKey = (item: Record<string, any>): string => {
    if (item?.id) return `id:${String(item.id)}`;
    if (item?.link) return `link:${String(item.link)}`;
    const text = String(item?.text || item?.snippet || item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const handle = String(item?.handle || item?.author || '').toLowerCase();
    const time = String(item?.time || '').slice(0, 40);
    return `hash:${handle}|${time}|${text}`;
  };

