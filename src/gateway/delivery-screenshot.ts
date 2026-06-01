import { browserVisionScreenshot } from './browser-tools.js';
import {
  desktopScreenshotWithHistory,
  desktopWindowScreenshot,
  getDesktopAdvisorPacket,
  parseDesktopScreenshotToolArgs,
} from './desktop-tools.js';
import { deliverToTargets, readAttachmentBuffer } from './delivery-router.js';

export interface ExecuteDeliverySendScreenshotDeps {
  telegramChannel?: any;
  broadcastWS?: (data: any) => void;
}

export async function executeDeliverySendScreenshot(
  args: any,
  workspacePath: string,
  deps: ExecuteDeliverySendScreenshotDeps,
  sessionId: string,
): Promise<{ result: string; error: boolean }> {
  const source = String(args?.source || 'desktop_new').trim().toLowerCase();
  const caption = String(args?.caption || args?.text || '').trim()
    || (source.startsWith('browser') ? 'Browser screenshot' : 'Desktop screenshot');
  let imageBuffer: Buffer | undefined;
  let mimeType = 'image/jpeg';
  let fileName = source.startsWith('browser') ? 'browser-screenshot.jpg' : 'desktop-screenshot.jpg';

  if (source === 'browser_new' || source === 'browser_last') {
    const shot = await browserVisionScreenshot(sessionId);
    if (!shot?.base64) return { result: 'ERROR: No browser screenshot available. Use browser_open first, or choose source="desktop_new".', error: true };
    imageBuffer = Buffer.from(shot.base64, 'base64');
    mimeType = shot.mimeType || 'image/jpeg';
  } else if (source === 'desktop_new' || source === 'desktop_last') {
    if (source === 'desktop_new') {
      const hasWindowTarget = !!(
        String(args?.name || '').trim()
        || (Number.isFinite(Number(args?.handle)) && Number(args?.handle) > 0)
        || args?.active === true
      );
      const capture = hasWindowTarget
        ? await desktopWindowScreenshot(sessionId, {
          name: args?.name == null ? undefined : String(args.name),
          handle: args?.handle == null ? undefined : Number(args.handle),
          active: args?.active === true,
          focus_first: args?.focus_first == null ? undefined : args.focus_first !== false,
          padding: args?.padding == null ? undefined : Number(args.padding),
        })
        : await desktopScreenshotWithHistory(sessionId, parseDesktopScreenshotToolArgs((args && typeof args === 'object') ? args as any : undefined));
      if (capture.startsWith('ERROR')) return { result: capture, error: true };
    }
    const packet = getDesktopAdvisorPacket(sessionId);
    if (!packet?.screenshotBase64) {
      return { result: 'ERROR: No desktop screenshot available. Call desktop_screenshot first or use source="desktop_new".', error: true };
    }
    imageBuffer = Buffer.from(packet.screenshotBase64, 'base64');
    mimeType = packet.screenshotMime || 'image/png';
  } else if (source === 'file') {
    const file = readAttachmentBuffer(String(args?.path || args?.file || args?.attachmentPath || ''), workspacePath);
    imageBuffer = file.buffer;
    mimeType = file.mimeType;
    fileName = file.fileName;
  } else {
    return { result: 'ERROR: source must be desktop_new, desktop_last, browser_new, browser_last, or file.', error: true };
  }

  const delivered = await deliverToTargets({
    sessionId,
    target: args?.target || 'origin',
    caption,
    text: caption,
    imageBuffer,
    mimeType,
    fileName,
    source: 'delivery_send_screenshot',
  }, { telegramChannel: deps.telegramChannel, broadcastWS: deps.broadcastWS });
  const suffix = delivered.errors.length ? ` Errors: ${delivered.errors.join('; ')}` : '';
  return {
    result: delivered.delivered.length
      ? `Screenshot delivered via ${delivered.delivered.join(', ')}.${suffix}`
      : `ERROR: Screenshot delivery failed.${suffix}`,
    error: delivered.delivered.length === 0,
  };
}
