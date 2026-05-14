import {
  executeWebFetch,
  webSearch,
} from '../../../tools/web';
import { executeDownloadMedia, executeDownloadUrl } from '../../../tools/download-tools';
import { executeAnalyzeImage, executeAnalyzeVideo } from '../../../tools/media-analysis';
import { executeGenerateImage } from '../../../tools/generate-image';
import { executeGenerateVideo } from '../../../tools/generate-video';
import { socialIntelTool } from '../../../tools/social-scraper.js';
import { addCreativeReferences, getCreativeReferences } from '../../session';
import { saveSiteShortcut } from '../../site-shortcuts';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import type { ToolResult } from '../../tool-builder';

const WEB_MEDIA_TOOL_NAMES = new Set([
  'social_intel',
  'web_search',
  'web_search_single',
  'web_search_multi',
  'web_fetch',
  'download_url',
  'download_media',
  'generate_image',
  'generate_video',
  'analyze_image',
  'analyze_video',
  'video_analyze_imported_video',
  'save_site_shortcut',
]);

function extractXStatusId(raw: any): string | null {
  const text = String(raw || '').trim();
  const match = text.match(/\/status\/(\d+)/i);
  return match?.[1] || (/^\d{8,}$/.test(text) ? text : null);
}

function registerCreativeReferencesFromXPayload(sessionId: string, payload: any): number {
  const report = payload?.x_media;
  const files = Array.isArray(report?.downloaded_files) ? report.downloaded_files : [];
  if (!files.length) return 0;
  const analyses = new Map<string, any>(
    (Array.isArray(report?.analyses) ? report.analyses : [])
      .map((item: any) => [String(item?.rel_path || ''), item])
      .filter((entry: any[]) => !!entry[0]),
  );
  const tweets = Array.isArray(payload?.tweets) ? payload.tweets : [];
  const primaryTweetId = extractXStatusId(payload?.url);
  const primaryTweet = tweets.find((tweet: any) => String(tweet?.id || '') === primaryTweetId) || tweets[0] || null;
  const primaryHandle = String(primaryTweet?.handle || '').replace(/^@/, '').toLowerCase();
  const tweetById = new Map<string, any>(tweets.map((tweet: any) => [String(tweet?.id || ''), tweet]));

  const references = files.map((file: any) => {
    const relPath = String(file?.rel_path || '').trim();
    const analysis = analyses.get(relPath);
    const sourceTweetId = String(file?.source_tweet_id || extractXStatusId(file?.source_tweet_link) || '').trim();
    const sourceTweet = tweetById.get(sourceTweetId);
    const sourceHandle = String(sourceTweet?.handle || '').replace(/^@/, '').toLowerCase();
    const authority = sourceTweetId && primaryTweetId && sourceTweetId === primaryTweetId
      ? 'primary'
      : (primaryHandle && sourceHandle && primaryHandle === sourceHandle ? 'supporting' : 'low');
    const kind = ['image', 'video', 'audio'].includes(String(file?.kind || '').toLowerCase())
      ? String(file.kind).toLowerCase()
      : 'other';
    return {
      sourceUrl: String(file?.url || payload?.url || '').trim() || null,
      sourceType: 'x_post' as const,
      sourceTweetId: sourceTweetId || null,
      sourceTweetLink: String(file?.source_tweet_link || '').trim() || null,
      authority: authority as any,
      intent: 'mixed' as const,
      kind: kind as any,
      path: relPath || null,
      absPath: file?.path ? String(file.path) : null,
      selectedFrames: Array.isArray(analysis?.sample_frames)
        ? analysis.sample_frames.map((frame: any) => String(frame || '').trim()).filter(Boolean)
        : (kind === 'image' && relPath ? [relPath] : []),
      analysis: analysis?.analysis ? String(analysis.analysis) : null,
      transcript: analysis?.transcript ? String(analysis.transcript) : null,
      note: `Auto-saved from web_fetch media extraction for ${payload?.url || file?.url || 'X media'}.`,
    };
  });
  const before = getCreativeReferences(sessionId).length;
  addCreativeReferences(sessionId, references);
  return Math.max(0, getCreativeReferences(sessionId).length - before);
}

export const webMediaCapabilityExecutor: CapabilityExecutor = {
  id: 'web-media',

  canHandle(name: string): boolean {
    return WEB_MEDIA_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId } = ctx;

    switch (name) {
      case 'social_intel': {
        const tr = await socialIntelTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr);
        return { name, args, result: resultStr, error: tr?.success === false };
      }

      case 'web_search': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: typeof args.multi_engine === 'boolean' ? args.multi_engine : undefined,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
        });
        return { name, args, result, error: false };
      }

      case 'web_search_single': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: false,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
        });
        return { name, args, result, error: false };
      }

      case 'web_search_multi': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          provider: 'multi' as any,
        });
        return { name, args, result, error: false };
      }

      case 'web_fetch': {
        const url = args.url || '';
        let extractionAction = 'Extracting Media';
        let analysisAction = 'Analyzing Media';
        const normalizePhaseAction = (message: string, fallback: string): string => {
          const cleaned = String(message || '').trim().replace(/[.]{3}\s*$/, '');
          return cleaned || fallback;
        };
        const emitSyntheticToolCall = (action: string) => {
          deps.sendSSE?.('tool_call', { action, synthetic: true, actor: 'web_fetch' });
        };
        const emitSyntheticToolResult = (action: string, resultText: string, error = false) => {
          deps.sendSSE?.('tool_result', {
            action,
            result: resultText,
            error,
            synthetic: true,
            actor: 'web_fetch',
            show_result: true,
          });
        };
        const webFetchResult = await executeWebFetch({ url, max_chars: args.max_chars }, (event) => {
          switch (event.phase) {
            case 'fetch_complete':
              emitSyntheticToolResult('web_fetch', event.message);
              break;
            case 'extracting_media':
              extractionAction = normalizePhaseAction(event.message, extractionAction);
              emitSyntheticToolCall(extractionAction);
              break;
            case 'extraction_complete':
              emitSyntheticToolResult(extractionAction, event.message);
              break;
            case 'analyzing_media':
              analysisAction = normalizePhaseAction(event.message, analysisAction);
              emitSyntheticToolCall(analysisAction);
              break;
            case 'analysis_complete':
            case 'analysis_skipped':
              emitSyntheticToolResult(analysisAction, event.message);
              break;
            default:
              deps.sendSSE?.('info', { message: event.message });
              break;
          }
        });
        let result = webFetchResult.success
          ? (webFetchResult.stdout || `Fetched ${url} but no content extracted.`)
          : (webFetchResult.stdout || webFetchResult.error || `Fetch failed for ${url}.`);
        const addedReferenceCount = webFetchResult.success
          ? registerCreativeReferencesFromXPayload(sessionId, webFetchResult.data)
          : 0;
        if (addedReferenceCount > 0) {
          const referenceSummary = `Added ${addedReferenceCount} media item${addedReferenceCount === 1 ? '' : 's'} to this session's Creative References bucket.`;
          deps.sendSSE?.('info', { message: referenceSummary });
          result = `${result}\n\n${referenceSummary}`;
        }
        const looksLikeFailure = result.startsWith('Fetch failed')
          || result.startsWith('Fetch error')
          || result.startsWith('Fetch timed')
          || /"success"\s*:\s*false/.test(result);
        return { name, args, result, error: looksLikeFailure, data: webFetchResult.data };
      }

      case 'download_url': {
        const toolResult = await executeDownloadUrl({
          url: String(args.url || ''),
          filename: args.filename != null ? String(args.filename) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'download_url complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'download_url failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'download_media': {
        const toolResult = await executeDownloadMedia({
          url: String(args.url || ''),
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          audio_only: args.audio_only === true,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'download_media complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'download_media failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'generate_image': {
        const toolResult = await executeGenerateImage({
          prompt: String(args.prompt || ''),
          reference_images: Array.isArray(args.reference_images)
            ? args.reference_images.map((item: any) => String(item))
            : (args.reference_images != null ? [String(args.reference_images)] : undefined),
          aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
          count: args.count != null ? Number(args.count) : undefined,
          provider: args.provider != null ? String(args.provider) : undefined,
          model: args.model != null ? String(args.model) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          save_to_workspace: args.save_to_workspace != null ? args.save_to_workspace === true : undefined,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'generate_image complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'generate_image failed'}`,
          error: toolResult.success !== true,
          extra: toolResult.success && toolResult.data
            ? {
                generated_image: Array.isArray(toolResult.data?.images) && toolResult.data.images.length
                  ? toolResult.data.images[0]
                  : toolResult.data,
                generated_images: Array.isArray(toolResult.data?.images)
                  ? toolResult.data.images
                  : [toolResult.data],
              }
            : undefined,
        };
      }

      case 'generate_video': {
        const toolResult = await executeGenerateVideo({
          prompt: String(args.prompt || ''),
          image: args.image != null ? String(args.image) : undefined,
          reference_images: Array.isArray(args.reference_images)
            ? args.reference_images.map((item: any) => String(item))
            : (args.reference_images != null ? [String(args.reference_images)] : undefined),
          video: args.video != null ? String(args.video) : undefined,
          mode: args.mode != null ? String(args.mode) : undefined,
          aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
          duration: args.duration != null ? Number(args.duration) : undefined,
          resolution: args.resolution != null ? String(args.resolution) : undefined,
          provider: args.provider != null ? String(args.provider) : undefined,
          model: args.model != null ? String(args.model) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          save_to_workspace: args.save_to_workspace != null ? args.save_to_workspace === true : undefined,
          poll_interval_ms: args.poll_interval_ms != null ? Number(args.poll_interval_ms) : undefined,
          timeout_ms: args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'generate_video complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'generate_video failed'}`,
          error: toolResult.success !== true,
          extra: toolResult.success && toolResult.data
            ? { generated_video: toolResult.data?.video || toolResult.data }
            : undefined,
        };
      }

      case 'analyze_image': {
        const toolResult = await executeAnalyzeImage({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'analyze_image complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'analyze_image failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'analyze_video':
      case 'video_analyze_imported_video': {
        const toolResult = await executeAnalyzeVideo({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
          sample_count: args.sample_count != null ? Number(args.sample_count) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          extract_audio: args.extract_audio !== false,
          transcribe: args.transcribe !== false,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || `${name} complete` }, null, 2)
            : `ERROR: ${toolResult.error || `${name} failed`}`,
          error: toolResult.success !== true,
        };
      }

      case 'save_site_shortcut': {
        const shortcutHostname = String(args.hostname || '').trim();
        const shortcutKey = String(args.key || '').trim();
        const shortcutAction = String(args.action || '').trim();
        if (!shortcutHostname || !shortcutKey || !shortcutAction) {
          return { name, args, result: 'save_site_shortcut: hostname, key, and action are required', error: true };
        }
        try {
          saveSiteShortcut(
            shortcutHostname,
            {
              key: shortcutKey,
              action: shortcutAction,
              context: args.context ? String(args.context) : undefined,
              preferred_for_compose: args.preferred_for_compose === true,
            },
            undefined,
            args.notes ? String(args.notes) : undefined,
          );
          return { name, args, result: `Shortcut saved: ${shortcutHostname} - "${shortcutKey}" -> ${shortcutAction}`, error: false };
        } catch (err: any) {
          return { name, args, result: `save_site_shortcut failed: ${err.message}`, error: true };
        }
      }

      default:
        return { name, args, result: `Unhandled web/media tool: ${name}`, error: true };
    }
  },
};
