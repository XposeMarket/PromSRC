import { webSearch } from './../../../tools/web';
import { executeWebFetch, executeWebFetchBatch, executeShoppingSearchProducts } from './../../../tools/web';
import { executeDownloadMedia, executeDownloadUrl } from './../../../tools/download-tools';
import { executeAnalyzeImage, executeAnalyzeVideo } from './../../../tools/media-analysis';
import { executeGenerateImage } from './../../../tools/generate-image';
import { executeGenerateVideo } from './../../../tools/generate-video';
import { buildGeneratedImageVisionEvent } from './../../generated-image-preview';
import { registerCreativeReferencesFromXPayload, persistSearchResultSources, persistFetchedSource } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleWebToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleWebTool(ctx: handleWebToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


      case 'web_search': {
        const result = await webSearch(args.query || (Array.isArray(args.queries) ? String(args.queries[0] || '') : ''), {
          queries: Array.isArray(args.queries) ? args.queries.map((q: unknown) => String(q || '')) : undefined,
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: typeof args.multi_engine === 'boolean' ? args.multi_engine : undefined,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
          fetch_top_k: args.fetch_top_k != null ? Number(args.fetch_top_k) : undefined,
          fetch_max_chars: args.fetch_max_chars != null ? Number(args.fetch_max_chars) : undefined,
          provider_timeout_ms: args.provider_timeout_ms != null ? Number(args.provider_timeout_ms) : undefined,
        });
        persistSearchResultSources(workspacePath, sessionId, result);
        return { name, args, result, error: false };
      }

      case 'web_search_single': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: false,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
          fetch_top_k: args.fetch_top_k != null ? Number(args.fetch_top_k) : undefined,
          fetch_max_chars: args.fetch_max_chars != null ? Number(args.fetch_max_chars) : undefined,
          provider_timeout_ms: args.provider_timeout_ms != null ? Number(args.provider_timeout_ms) : undefined,
        });
        persistSearchResultSources(workspacePath, sessionId, result);
        return { name, args, result, error: false };
      }

      case 'web_search_multi': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          provider: 'multi' as any,
          fetch_top_k: args.fetch_top_k != null ? Number(args.fetch_top_k) : undefined,
          fetch_max_chars: args.fetch_max_chars != null ? Number(args.fetch_max_chars) : undefined,
          provider_timeout_ms: args.provider_timeout_ms != null ? Number(args.provider_timeout_ms) : undefined,
        });
        persistSearchResultSources(workspacePath, sessionId, result);
        return { name, args, result, error: false };
      }

      case 'shopping_search_products': {
        const tr = await executeShoppingSearchProducts({
          query: args.query || '',
          merchant: args.merchant != null ? String(args.merchant) : undefined,
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
          include_metadata: typeof args.include_metadata === 'boolean' ? args.include_metadata : undefined,
          include_images: typeof args.include_images === 'boolean' ? args.include_images : undefined,
          metadata_timeout_ms: args.metadata_timeout_ms != null ? Number(args.metadata_timeout_ms) : undefined,
          image_timeout_ms: args.image_timeout_ms != null ? Number(args.image_timeout_ms) : undefined,
        }) as any;
        return {
          name,
          args,
          result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
          error: tr?.success === false,
          data: tr?.data,
          extra: tr?.extra,
        };
      }

		      case 'web_fetch': {
		        const batchUrls = Array.isArray(args.urls) ? args.urls.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
		        if (batchUrls.length > 0) {
	          const batchResult = await executeWebFetchBatch({
	            urls: batchUrls,
	            max_chars: args.max_chars != null ? Number(args.max_chars) : undefined,
	            concurrency: args.concurrency != null ? Number(args.concurrency) : undefined,
	          });
	          const fetchedRows = Array.isArray(batchResult.data?.results) ? batchResult.data.results : [];
	          for (const row of fetchedRows) {
	            if (!row || typeof row !== 'object') continue;
	            persistFetchedSource(workspacePath, sessionId, {
	              url: row.url,
	              title: row.data?.title || row.url,
	              text: row.text,
	              mimeType: row.data?.content_type || 'text/html',

              fetched: row.status === 'ok',
            });
          }
	          return {
		            name,
		            args,
		            result: batchResult.stdout || batchResult.error || 'Batch fetch completed without output.',
		            error: batchResult.success !== true,
		            data: batchResult.data,
		          };
		        }
		        const url = args.url || '';
		        {
		          let extractionAction = 'Extracting Media';
		          let analysisAction = 'Analyzing Media';
		          const normalizePhaseAction = (message: string, fallback: string): string => {
		            const cleaned = String(message || '').trim().replace(/[.]{3}\s*$/, '');
		            return cleaned || fallback;
		          };
		          const emitSyntheticToolCall = (action: string) => {
		            deps.sendSSE?.('tool_call', {
		              action,
		              synthetic: true,
		              actor: 'web_fetch',
		            });
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
		          const webFetchResult = await executeWebFetch({
		            url,
		            max_chars: args.max_chars,
		            include_media: args.include_media === true,
		            include_thread: args.include_thread === true,
		          }, (event) => {
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
	          if (webFetchResult.success) {
	            persistFetchedSource(workspacePath, sessionId, {
	              url: webFetchResult.data?.final_url || webFetchResult.data?.url || url,
	              title: webFetchResult.data?.title || url,
              text: webFetchResult.stdout || '',
              mimeType: webFetchResult.data?.content_type || 'text/html',
              fetched: true,
            });
          }
	          const looksLikeFailure = result.startsWith('Fetch failed')
		            || result.startsWith('Fetch error')
		            || result.startsWith('Fetch timed')
		            || /"success"\s*:\s*false/.test(result);
		          return { name, args, result, error: looksLikeFailure, data: webFetchResult.data };
		        }

          // X/Twitter URL — use specialized scraper with snapshots + deltas

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
	          signal: deps.abortSignal?.signal,
	          onProgress: (progress) => deps.sendSSE?.('tool_progress', {
	            action: name,
	            name,
	            message: progress.message,
	            phase: progress.phase,
	            percent: progress.percent,
	            speed: progress.speed,
	            eta: progress.eta,
	            show_pill: true,
	          }),
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
		          background: args.background != null ? String(args.background) : undefined,
		          output_format: args.output_format != null ? String(args.output_format) : undefined,
		          output_compression: args.output_compression != null ? Number(args.output_compression) : undefined,
		          quality: args.quality != null ? String(args.quality) : undefined,
		          size: args.size != null ? String(args.size) : undefined,
		          width: args.width != null ? Number(args.width) : undefined,
		          height: args.height != null ? Number(args.height) : undefined,
		          mask: args.mask != null ? String(args.mask) : undefined,
		          presentation_mode: args.presentation_mode === 'background' ? 'background' : 'foreground',
		          partial_images: args.partial_images,
		          stream: args.stream === true,
		          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	          save_to_workspace: args.save_to_workspace != null ? args.save_to_workspace === true : undefined,
		          on_image_persisted: (image) => {
		            if (args.presentation_mode !== 'background') return;
		            const event = buildGeneratedImageVisionEvent({ image, tool: name, label: 'Generated image' });
		            if (event) deps.sendSSE?.('vision_injected', event);
		          },
		          on_partial_image: (image: any) => {
		            if (args.presentation_mode !== 'background') return;
		            const event = buildGeneratedImageVisionEvent({ image, tool: name, label: 'Generated image partial' });
		            if (event) deps.sendSSE?.('vision_injected', event);
		          },
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
		            ? {
		                generated_video: toolResult.data?.video || toolResult.data,
		                generated_videos: [toolResult.data?.video || toolResult.data],
		              }
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
	          data: toolResult.success === true ? toolResult.data : undefined,
	        };
	      }

      case 'analyze_video': {
        const toolResult = await executeAnalyzeVideo({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
          sample_count: args.sample_count != null ? Number(args.sample_count) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	          extract_audio: args.extract_audio !== false,
	          transcribe: args.transcribe !== false,
	          signal: deps.abortSignal?.signal,
	          onProgress: (progress) => deps.sendSSE?.('tool_progress', {
	            action: name, name, message: progress.message, phase: progress.phase,
	            current: progress.current, total: progress.total,
	            ratio: progress.total ? Number(progress.current || 0) / progress.total : undefined,
	            show_pill: true,
	          }),
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'analyze_video complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'analyze_video failed'}`,
          error: toolResult.success !== true,
          data: toolResult.success === true ? toolResult.data : undefined,
        };
      }
 }
 throw new Error(`Unsupported web tool: ${name}`);
}
