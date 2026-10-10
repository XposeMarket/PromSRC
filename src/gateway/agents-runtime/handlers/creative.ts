/**
 * Creative, video and HyperFrames: tool handlers extracted verbatim from executeToolRaw
 * (subagent-executor.ts). Behaviour is unchanged: executeToolRaw delegates
 * these case labels here with the locals it used to close over.
 */
import type { ExecutorHandlerContext } from './handler-context';
import { applyHtmlMotionTemplate, summarizeHtmlMotionTemplates } from '../../creative/html-motion-templates';
import { buildCreativeLibraryPayload, createCreativeLibraryPack, saveCustomHtmlMotionBlock, saveCustomHtmlMotionTemplate, saveCustomSceneTemplate, toggleCreativeLibraryPack } from '../../creative/custom-registries';
import { checkTextFit, reportHtmlTextFit } from '../../creative/pretext-measure';
import { creativeAddAudioTrack, creativeAddMusicBed, creativeAddSoundEffects, creativeAnalyzeGeneratedVideo, creativeAutoAssembleRoughCut, creativeChainScene, creativeCompareShots, creativeCompositeVideoLayers, creativeCreateProject, creativeCreateStoryboard, creativeDownloadAudio, creativeExtractAudioFromVideo, creativeExtractLayersForGeneration, creativeExtractVideoFrame, creativeExtractVideoFrames, creativeGenerateImageShot, creativeGenerateMotionGraphicsLayer, creativeGenerateSequence, creativeGenerateVideoShot, creativeGenerateVoiceover, creativeGetProject, creativeGetStoryboard, creativeImportAudio, creativeListGenerations, creativeListProjects, creativeListStoryboards, creativeMixAudioTracks, creativeNormalizeLayerSpecs, creativeOverlayHyperframesOnVideo, creativePickContinuityFrame, creativePreflightOverlay, creativeRefineVideoShot, creativeRegisterGeneration, creativeRenderGeneratedSequence, creativeRetryShotUntilPass, creativeSampleCompositeFrames, creativeSelectBestTake, creativeStitchClips, creativeSyncCaptionsToAudio, creativeTranscribeAudio, creativeValidateCompositionLayers, creativeWrapVideoAsHtmlMotionClip, creativeWriteShotPrompt } from '../../creative/generative-pipeline';
import { executeDownloadMedia } from '../../../tools/download-tools';
import { getCreativeMode, setCreativeMode } from '../../session';
import { lintHtmlMotionComposition } from '../../creative/html-motion-spec';
import { listHtmlMotionBlocks, renderHtmlMotionBlock } from '../../creative/html-motion-blocks';
import { sendCreativeCommand } from '../../creative/command-bus';
import { VIDEO_MODE_REMOVED_SCENE_TOOL_NAMES, buildCreativeStorageForTool, buildCreativeWorkspaceRelativePath, ensureCreativeLocalWorkspacePath, extractCreativeAudioFromVideo, firstDownloadedMediaFile, getCreativeAsciiRenderRuntime, getCreativeAssets, getCreativeLayerExtraction, getCreativeModelPaths, getCreativeMotionRuntime, getHyperframesBridge, getHyperframesCatalog, getHyperframesExportAdapter, getHyperframesProducer, getHyperframesQa, inferCreativeLocalMediaKind, isLegacySceneGraphCompositionPayload, maybeSendCreativeExportToTelegram, mergeHyperframesInputs, normalizeCreativeAudioTags, patchHyperframesClipInEditor, readSelectedHyperframesClipFromEditor, resolveCreativeEditorTimeoutMs, resolveCreativeToolSource, resolveWorkspaceFilePath, sanitizeCreativeStorageSegment, videoModeHtmlMotionOnlyError, wrapHyperframesBlockAsDocument } from '../subagent-executor';
import fs from 'fs';
import path from 'path';
import type { HyperframesPatchOp } from '../../creative/hyperframes-bridge';

export async function handleCreativeTool(ctx: ExecutorHandlerContext): Promise<any> {
  const { name, args, workspacePath, deps, sessionId } = ctx;
  void workspacePath; void deps; void sessionId;
  switch (name) {
      case 'creative_list_motion_templates': {
        const catalog = getCreativeMotionRuntime().getCreativeMotionCatalog();
        return {
          name,
          args,
          result: `Found ${catalog.templates.length} Creative Motion templates and ${catalog.socialPresets.length} social presets.`,
          error: false,
          data: catalog,
        };
      }

      case 'creative_preview_motion_template':
      case 'creative_generate_motion_variants': {
        const catalog = getCreativeMotionRuntime().getCreativeMotionCatalog();
        if (name === 'creative_generate_motion_variants') {
          const templateId = String(args?.templateId || 'caption-reel').trim().toLowerCase();
          const template = catalog.templates.find((candidate: any) => candidate.id === templateId) || catalog.templates[0];
          const count = Math.max(1, Math.min(8, Number(args?.count) || Math.min(3, template?.presets?.length || 3)));
          const variants = (template?.presets || []).slice(0, count).map((preset: any, index: number) => {
            const prepared = getCreativeMotionRuntime().prepareCreativeMotionTemplate({
              ...(args || {}),
              templateId: template.id,
              presetId: preset.id,
              style: {
                ...(preset.style || {}),
                ...(args?.style && typeof args.style === 'object' ? args.style : {}),
              },
            });
            return {
              id: `variant_${index + 1}_${preset.id}`,
              preset,
              input: prepared.input,
              instance: prepared.instance,
              validation: prepared.validation,
            };
          });
          return {
            name,
            args,
            result: `Generated ${variants.length} motion template variants for ${template?.name || templateId}.`,
            error: false,
            data: { template, variants },
          };
        }
        const prepared = getCreativeMotionRuntime().prepareCreativeMotionTemplate(args || {});
        return {
          name,
          args,
          result: prepared.validation.ok
            ? `Prepared ${prepared.template?.name || prepared.input.templateId} motion template preview input.`
            : `Motion template preview has blockers: ${prepared.validation.blockers.join('; ')}`,
          error: !prepared.validation.ok,
          data: prepared,
        };
      }

      case 'creative_import_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const sourceInput = resolveCreativeToolSource(storage, args || {}, 'creative_import_asset', 'source asset');
        if (!sourceInput.source) {
          return { name, args, result: sourceInput.error || 'creative_import_asset requires a source asset.', error: true };
        }
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: sourceInput.source,
          filename: args?.filename ? String(args.filename) : undefined,
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          copy: args?.copy !== false,
        });
        return {
          name,
          args,
          result: `Imported creative asset ${asset.name} (${asset.kind}${asset.width && asset.height ? `, ${asset.width}x${asset.height}` : ''}${asset.durationMs ? `, ${asset.durationMs}ms` : ''}).`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_attach_audio_from_url': {
        const url = String(args?.url || '').trim();
        if (!url) {
          return { name, args, result: 'creative_attach_audio_from_url: url is required', error: true };
        }
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const downloadsDir = path.join(storage.creativeDir, 'source-audio');
        fs.mkdirSync(downloadsDir, { recursive: true });
        const downloadResult = await executeDownloadMedia({
          url,
          output_dir: buildCreativeWorkspaceRelativePath(storage.workspacePath, downloadsDir),
          audio_only: true,
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
        if (downloadResult.success !== true) {
          return {
            name,
            args,
            result: `ERROR: ${downloadResult.error || 'Could not download audio from URL.'}`,
            error: true,
            data: { download: downloadResult.data || null },
          };
        }
        const downloaded = firstDownloadedMediaFile(downloadResult);
        const downloadedPath = String(downloaded?.path || downloaded?.rel_path || '').trim();
        if (!downloadedPath) {
          return {
            name,
            args,
            result: 'ERROR: Audio download completed, but no output file was detected.',
            error: true,
            data: { download: downloadResult.data || null },
          };
        }
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: downloadedPath,
          tags: normalizeCreativeAudioTags(args?.tags),
          copy: true,
        });
        if (asset.kind !== 'audio') {
          return {
            name,
            args,
            result: `ERROR: Downloaded media was imported as ${asset.kind}, not audio.`,
            error: true,
            data: { asset, download: downloadResult.data || null },
          };
        }
        const audioSource = asset.path || asset.relativePath || asset.absPath || asset.source;
        const audioTrack = {
          source: audioSource,
          label: String(args?.label || asset.name || 'Background audio').trim() || 'Background audio',
          startMs: Math.max(0, Number(args?.startMs) || 0),
          durationMs: Math.max(0, Number(args?.durationMs) || Number(asset.durationMs) || 0),
          trimStartMs: Math.max(0, Number(args?.trimStartMs) || 0),
          trimEndMs: Math.max(0, Number(args?.trimEndMs) || 0),
          volume: Math.max(0, Math.min(1, Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1)),
          muted: false,
          fadeInMs: Math.max(0, Number(args?.fadeInMs) || 0),
          fadeOutMs: Math.max(0, Number(args?.fadeOutMs) || 0),
        };
        const placement = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'attach_audio',
          payload: { audioTrack, sourceUrl: url, asset },
          timeoutMs: resolveCreativeEditorTimeoutMs(name),
        });
        return {
          name,
          args,
          result: placement.success
            ? `Attached downloaded audio "${audioTrack.label}" to the Video timeline${asset.durationMs ? ` (${asset.durationMs}ms)` : ''}.`
            : `Downloaded and imported audio, but the creative editor did not attach it: ${placement.error || 'unknown editor error'}`,
          error: !placement.success,
          data: {
            url,
            asset,
            audioTrack,
            download: downloadResult.data || null,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_attach_audio_from_file': {
        const source = String(args?.source || '').trim();
        if (!source) {
          return { name, args, result: 'creative_attach_audio_from_file: source is required', error: true };
        }
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let sourceAbsPath = '';
        try {
          sourceAbsPath = ensureCreativeLocalWorkspacePath(storage.workspacePath, source);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${String(err?.message || err)}`, error: true };
        }
        const sourceKind = inferCreativeLocalMediaKind(sourceAbsPath);
        let audioInputPath = sourceAbsPath;
        let extractedFromVideo = false;
        if (sourceKind !== 'audio') {
          try {
            audioInputPath = await extractCreativeAudioFromVideo(sourceAbsPath, path.join(storage.creativeDir, 'extracted-audio'));
            extractedFromVideo = true;
          } catch (err: any) {
            return {
              name,
              args,
              result: `ERROR: Could not extract audio from ${path.basename(sourceAbsPath)} (${String(err?.message || err)}).`,
              error: true,
            };
          }
        }
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: audioInputPath,
          tags: normalizeCreativeAudioTags([...(Array.isArray(args?.tags) ? args.tags : String(args?.tags || '').split(',')), extractedFromVideo ? 'extracted-audio' : 'source-audio']),
          copy: true,
        });
        if (asset.kind !== 'audio') {
          return {
            name,
            args,
            result: `ERROR: Imported source was classified as ${asset.kind}, not audio.`,
            error: true,
            data: { asset },
          };
        }
        const audioSource = asset.path || asset.relativePath || asset.absPath || asset.source;
        const audioTrack = {
          source: audioSource,
          label: String(args?.label || asset.name || (extractedFromVideo ? 'Extracted audio' : 'Audio')).trim() || 'Audio',
          startMs: Math.max(0, Number(args?.startMs) || 0),
          durationMs: Math.max(0, Number(args?.durationMs) || Number(asset.durationMs) || 0),
          trimStartMs: Math.max(0, Number(args?.trimStartMs) || 0),
          trimEndMs: Math.max(0, Number(args?.trimEndMs) || 0),
          volume: Math.max(0, Math.min(1, Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1)),
          muted: false,
          fadeInMs: Math.max(0, Number(args?.fadeInMs) || 0),
          fadeOutMs: Math.max(0, Number(args?.fadeOutMs) || 0),
        };
        const placement = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'attach_audio',
          payload: { audioTrack, sourceFile: buildCreativeWorkspaceRelativePath(storage.workspacePath, sourceAbsPath), extractedFromVideo, asset },
          timeoutMs: resolveCreativeEditorTimeoutMs(name),
        });
        return {
          name,
          args,
          result: placement.success
            ? `Attached ${extractedFromVideo ? 'extracted ' : ''}audio "${audioTrack.label}" to the Video timeline${asset.durationMs ? ` (${asset.durationMs}ms)` : ''}.`
            : `Imported audio, but the creative editor did not attach it: ${placement.error || 'unknown editor error'}`,
          error: !placement.success,
          data: {
            source,
            extractedFromVideo,
            extractedAudioPath: extractedFromVideo ? buildCreativeWorkspaceRelativePath(storage.workspacePath, audioInputPath) : null,
            asset,
            audioTrack,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_analyze_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const sourceInput = resolveCreativeToolSource(storage, args || {}, 'creative_analyze_asset', 'source asset');
        if (!sourceInput.source) {
          return { name, args, result: sourceInput.error || 'creative_analyze_asset requires a source asset.', error: true };
        }
        const asset = await getCreativeAssets().analyzeCreativeAsset(storage, {
          source: sourceInput.source,
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          force: args?.force === true,
          upsert: args?.upsert !== false,
        });
        return {
          name,
          args,
          result: `Analyzed creative asset ${asset.name} (${asset.kind}${asset.width && asset.height ? `, ${asset.width}x${asset.height}` : ''}${asset.durationMs ? `, ${asset.durationMs}ms` : ''}).`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_search_assets': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const assets = getCreativeAssets().searchCreativeAssets(storage, {
          query: String(args?.query || '').trim(),
          kinds: Array.isArray(args?.kinds) ? args.kinds : [],
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          limit: Math.max(1, Math.min(200, Number(args?.limit) || 50)),
        });
        const index = getCreativeAssets().readCreativeAssetIndex(storage);
        return {
          name,
          args,
          result: assets.length
            ? `Found ${assets.length} creative assets (${index.assets.length} indexed total).`
            : `No creative assets matched. ${index.assets.length} assets are indexed.`,
          error: false,
          data: { assets, total: index.assets.length, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_generate_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const asset = await getCreativeAssets().generateCreativeAssetPlaceholder(storage, {
          prompt: String(args?.prompt || '').trim(),
          width: Number(args?.width) || undefined,
          height: Number(args?.height) || undefined,
          kind: args?.kind === 'image' ? 'image' : 'svg',
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
        });
        return {
          name,
          args,
          result: `Generated creative asset ${asset.name} (${asset.width}x${asset.height}) and added it to the asset index.`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_create_project': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const created = creativeCreateProject(storage, {
            title: args?.title ? String(args.title) : undefined,
            brief: args?.brief ? String(args.brief) : undefined,
            targetFormat: args?.targetFormat || args?.target_format ? String(args.targetFormat || args.target_format) : undefined,
            targetDurationSec: Number.isFinite(Number(args?.targetDurationSec ?? args?.target_duration_sec)) ? Number(args?.targetDurationSec ?? args?.target_duration_sec) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            storyboard: args?.storyboard && typeof args.storyboard === 'object' ? args.storyboard : undefined,
            sourceAssets: Array.isArray(args?.sourceAssets || args?.source_assets)
              ? (args.sourceAssets || args.source_assets).map((item: any) => String(item)).filter(Boolean)
              : (args?.sourceAssets || args?.source_assets ? String(args.sourceAssets || args.source_assets) : undefined),
            notes: args?.notes && typeof args.notes === 'object' ? args.notes : {},
          });
          return {
            name,
            args,
            result: `Created Creative project ${created.project.id} at ${created.path}${created.storyboard ? ` with storyboard ${created.storyboard.id}` : ''}.`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_project_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const projectId = args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : '';
          if (projectId || args?.path) {
            const project = creativeGetProject(storage, { projectId, path: args?.path ? String(args.path) : undefined });
            return {
              name,
              args,
              result: `Loaded Creative project ${project.id}: ${project.title}.\n${JSON.stringify(project).slice(0, 10000)}`,
              error: false,
              data: { project },
            };
          }
          const projects = creativeListProjects(storage, { limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined });
          return {
            name,
            args,
            result: `${name}: ${projects.length} project record${projects.length === 1 ? '' : 's'}.\n${JSON.stringify({ projects }).slice(0, 8000)}`,
            error: false,
            data: { projects },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_create_storyboard': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const created = creativeCreateStoryboard(storage, {
            title: args?.title ? String(args.title) : undefined,
            brief: args?.brief ? String(args.brief) : undefined,
            styleGuide: args?.styleGuide || args?.style_guide ? String(args.styleGuide || args.style_guide) : undefined,
            characterBible: args?.characterBible || args?.character_bible ? String(args.characterBible || args.character_bible) : undefined,
            shots: Array.isArray(args?.shots) ? args.shots : [],
            metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {},
          });
          return {
            name,
            args,
            result: `Created storyboard ${created.storyboard.id} with ${created.storyboard.shots.length} shot${created.storyboard.shots.length === 1 ? '' : 's'} at ${created.path}.`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_storyboard_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const storyboardId = args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : '';
          if (storyboardId || args?.path) {
            const storyboard = creativeGetStoryboard(storage, { storyboardId, path: args?.path ? String(args.path) : undefined });
            return {
              name,
              args,
              result: `Loaded storyboard ${storyboard.id} with ${storyboard.shots.length} shot${storyboard.shots.length === 1 ? '' : 's'}.\n${JSON.stringify(storyboard).slice(0, 9000)}`,
              error: false,
              data: { storyboard },
            };
          }
          const storyboards = creativeListStoryboards(storage, { limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined });
          return {
            name,
            args,
            result: `${name}: ${storyboards.length} storyboard record${storyboards.length === 1 ? '' : 's'}.\n${JSON.stringify({ storyboards }).slice(0, 7000)}`,
            error: false,
            data: { storyboards },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_write_shot_prompt': {
        try {
          const prompt = creativeWriteShotPrompt({
            subject: args?.subject ? String(args.subject) : undefined,
            action: args?.action ? String(args.action) : undefined,
            setting: args?.setting ? String(args.setting) : undefined,
            camera: args?.camera ? String(args.camera) : undefined,
            lighting: args?.lighting ? String(args.lighting) : undefined,
            style: args?.style ? String(args.style) : undefined,
            continuity: args?.continuity ? String(args.continuity) : undefined,
            endingFrameGoal: args?.endingFrameGoal || args?.ending_frame_goal ? String(args.endingFrameGoal || args.ending_frame_goal) : undefined,
            negatives: Array.isArray(args?.negatives) ? args.negatives : (args?.negatives ? String(args.negatives) : undefined),
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
          });
          return {
            name,
            args,
            result: `Wrote shot prompt.\n${JSON.stringify(prompt, null, 2)}`,
            error: false,
            data: prompt,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_render_ascii_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const render = await getCreativeAsciiRenderRuntime().renderCreativeAsciiAsset(storage, {
          source: args?.source ? String(args.source).trim() : undefined,
          mode: args?.mode,
          width: Number(args?.width) || undefined,
          height: Number(args?.height) || undefined,
          durationMs: Number(args?.durationMs) || undefined,
          frameRate: Number(args?.frameRate) || undefined,
          quality: args?.quality,
          glyphSet: args?.glyphSet ? String(args.glyphSet) : undefined,
          palette: Array.isArray(args?.palette) ? args.palette : (args?.palette ? String(args.palette) : undefined),
          style: args?.style ? String(args.style) : undefined,
          motion: args?.motion ? String(args.motion) : undefined,
          fit: args?.fit ? String(args.fit) : undefined,
          background: args?.background ? String(args.background) : undefined,
          glitch: Number.isFinite(Number(args?.glitch)) ? Number(args.glitch) : undefined,
          glow: Number.isFinite(Number(args?.glow)) ? Number(args.glow) : undefined,
          seed: Number.isFinite(Number(args?.seed)) ? Number(args.seed) : undefined,
          filename: args?.filename ? String(args.filename) : undefined,
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          importToCreative: args?.importToCreative !== false,
          keepFrames: args?.keepFrames === true,
          timeoutMs: Number(args?.timeoutMs) || undefined,
        });
        let placement: any = null;
        const placeInScene = args?.placeInScene === true;
        const creativeMode = getCreativeMode(sessionId);
        const sourceForPlacement = render.asset?.path || render.asset?.absPath || render.outputWorkspacePath || render.outputPath;
        if (placeInScene && sourceForPlacement && creativeMode && creativeMode !== 'design') {
          placement = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'add_asset',
            payload: {
              source: sourceForPlacement,
              assetType: 'video',
              x: Number(args?.x) || 0,
              y: Number(args?.y) || 0,
              width: Number(args?.layerWidth) || Number(args?.width) || render.asset?.width || undefined,
              height: Number(args?.layerHeight) || Number(args?.height) || render.asset?.height || undefined,
              fit: args?.layerFit || args?.fit || 'cover',
              startMs: Number(args?.startMs) || 0,
              durationMs: Number(args?.layerDurationMs) || Number(args?.durationMs) || render.asset?.durationMs || undefined,
              muted: args?.muted !== false,
              meta: {
                sourceTool: 'creative_render_ascii_asset',
                assetId: render.asset?.id || null,
                asciiJobId: render.job.id,
              },
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
          });
        }
        return {
          name,
          args,
          result: `Rendered Python ASCII asset${render.asset ? ` ${render.asset.name}` : ''} (${render.renderer.width}x${render.renderer.height}, ${render.renderer.durationMs}ms, ${render.renderer.frameRate}fps)${placement ? '; placement attempted in the active Creative workspace.' : '.'}`,
          error: false,
          data: {
            ...render,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_extract_video_frame': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractVideoFrame(storage, {
            source: String(args?.source || args?.video || '').trim(),
            frame: args?.frame,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            timestampMs: Number.isFinite(Number(args?.timestampMs ?? args?.timestamp_ms)) ? Number(args?.timestampMs ?? args?.timestamp_ms) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            outputName: args?.outputName || args?.output_name ? String(args.outputName || args.output_name) : undefined,
            registerAsAsset: args?.registerAsAsset !== false && args?.register_as_asset !== false,
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Extracted video frame to ${extracted.frame.path}${extracted.asset ? ` and imported asset ${extracted.asset.id}.` : '.'}\n${JSON.stringify({
              frame: extracted.frame,
              asset: extracted.asset,
              durationMs: extracted.durationMs,
            }).slice(0, 5000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_video_frames': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractVideoFrames(storage, {
            source: String(args?.source || args?.video || '').trim(),
            frames: Array.isArray(args?.frames) ? args.frames : undefined,
            timestamps: Array.isArray(args?.timestamps) ? args.timestamps.map((item: any) => Number(item)).filter(Number.isFinite) : undefined,
            percents: Array.isArray(args?.percents) ? args.percents.map((item: any) => Number(item)).filter(Number.isFinite) : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
            rangeStartPercent: Number.isFinite(Number(args?.rangeStartPercent ?? args?.range_start_percent)) ? Number(args?.rangeStartPercent ?? args?.range_start_percent) : undefined,
            rangeEndPercent: Number.isFinite(Number(args?.rangeEndPercent ?? args?.range_end_percent)) ? Number(args?.rangeEndPercent ?? args?.range_end_percent) : undefined,
            outputNamePrefix: args?.outputNamePrefix || args?.output_name_prefix ? String(args.outputNamePrefix || args.output_name_prefix) : undefined,
            registerAsAssets: args?.registerAsAssets !== false && args?.register_as_assets !== false,
            contactSheet: args?.contactSheet !== false && args?.contact_sheet !== false,
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Extracted ${extracted.frames.length} video frame${extracted.frames.length === 1 ? '' : 's'}${extracted.contactSheet ? ` with contact sheet ${extracted.contactSheet.path}` : ''}.\n${JSON.stringify({
              frames: extracted.frames,
              assetCount: extracted.assets.length,
              contactSheet: extracted.contactSheet,
              durationMs: extracted.durationMs,
            }).slice(0, 7000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_register_generation': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const registered = await creativeRegisterGeneration(storage, {
            kind: args?.kind,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : null,
            attempt: Number.isFinite(Number(args?.attempt)) ? Number(args.attempt) : undefined,
            prompt: args?.prompt ? String(args.prompt) : null,
            provider: args?.provider ? String(args.provider) : null,
            model: args?.model ? String(args.model) : null,
            mode: args?.mode ? String(args.mode) : null,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : null,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : null,
            sourceImage: args?.sourceImage || args?.source_image ? String(args.sourceImage || args.source_image) : null,
            sourceVideo: args?.sourceVideo || args?.source_video ? String(args.sourceVideo || args.source_video) : null,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item)).filter(Boolean)
              : [],
            outputPath: args?.outputPath || args?.output_path ? String(args.outputPath || args.output_path) : null,
            metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {},
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Registered generation ${registered.generation.id}${registered.asset ? ` for asset ${registered.asset.id}` : ''}.\n${JSON.stringify(registered).slice(0, 5000)}`,
            error: false,
            data: registered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generation_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const generations = creativeListGenerations(storage, {
          shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
          limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined,
        });
        return {
          name,
          args,
          result: `${name}: ${generations.length} generation record${generations.length === 1 ? '' : 's'}.\n${JSON.stringify({ generations }).slice(0, 8000)}`,
          error: false,
          data: { generations },
        };
      }

      case 'creative_generate_image_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateImageShot(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            styleGuide: args?.styleGuide || args?.style_guide ? String(args.styleGuide || args.style_guide) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            characterReferences: Array.isArray(args?.characterReferences || args?.character_references)
              ? (args.characterReferences || args.character_references).map((item: any) => String(item))
              : (args?.characterReferences || args?.character_references ? String(args.characterReferences || args.character_references) : undefined),
            locationReferences: Array.isArray(args?.locationReferences || args?.location_references)
              ? (args.locationReferences || args.location_references).map((item: any) => String(item))
              : (args?.locationReferences || args?.location_references ? String(args.locationReferences || args.location_references) : undefined),
            negativePrompt: args?.negativePrompt || args?.negative_prompt ? String(args.negativePrompt || args.negative_prompt) : undefined,
            seed: args?.seed,
            continuityId: args?.continuityId || args?.continuity_id ? String(args.continuityId || args.continuity_id) : undefined,
            outputRole: args?.outputRole || args?.output_role,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          if (generated.toolResult.success && args?.addToEditor !== false && args?.add_to_editor !== false) {
            const primaryAsset = generated.assets?.[0] || generated.primary?.asset || null;
            const source = primaryAsset?.path || primaryAsset?.relativePath || generated.primary?.path || generated.primary?.file || '';
            if (source) {
              await sendCreativeCommand(deps.broadcastWS, {
                sessionId,
                mode: 'video',
                command: 'add_asset',
                payload: {
                  source,
                  type: 'image',
                  assetType: 'image',
                  fit: 'cover',
                  meta: {
                    shotId: args?.shotId || args?.shot_id || null,
                    generationId: generated.generations?.[0]?.id || null,
                  },
                },
                timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
              }).catch(() => undefined);
            }
          }
          return {
            name,
            args,
            result: generated.toolResult.success
              ? `Generated ${generated.images.length} image shot${generated.images.length === 1 ? '' : 's'} and registered ${generated.generations.length} generation record${generated.generations.length === 1 ? '' : 's'}.\n${JSON.stringify({
                primary: generated.primary,
                assets: generated.assets,
                generations: generated.generations,
              }).slice(0, 9000)}`
              : `ERROR: ${generated.toolResult.error || 'image shot generation failed'}`,
            error: generated.toolResult.success !== true,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_video_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateVideoShot(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            image: args?.image ? String(args.image) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            video: args?.video ? String(args.video) : undefined,
            mode: args?.mode ? String(args.mode) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
            pollIntervalMs: Number.isFinite(Number(args?.pollIntervalMs ?? args?.poll_interval_ms)) ? Number(args?.pollIntervalMs ?? args?.poll_interval_ms) : undefined,
            timeoutMs: Number.isFinite(Number(args?.timeoutMs ?? args?.timeout_ms)) ? Number(args?.timeoutMs ?? args?.timeout_ms) : undefined,
          });
          if (generated.toolResult.success && args?.addToEditor !== false && args?.add_to_editor !== false) {
            const source = generated.asset?.path || generated.asset?.relativePath || generated.video?.path || generated.video?.file || '';
            if (source) {
              await sendCreativeCommand(deps.broadcastWS, {
                sessionId,
                mode: 'video',
                command: 'add_asset',
                payload: {
                  source,
                  type: 'video',
                  assetType: 'video',
                  fit: 'cover',
                  durationMs: Number(generated.asset?.durationMs || args?.duration || 0) || undefined,
                  meta: {
                    shotId: args?.shotId || args?.shot_id || null,
                    generationId: generated.generation?.id || null,
                  },
                },
                timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
              }).catch(() => undefined);
            }
          }
          return {
            name,
            args,
            result: generated.toolResult.success
              ? `Generated video shot${generated.generation ? ` ${generated.generation.id}` : ''}${generated.asset ? ` and imported asset ${generated.asset.id}` : ''}.\n${JSON.stringify({
                video: generated.video,
                asset: generated.asset,
                generation: generated.generation,
              }).slice(0, 7000)}`
              : `ERROR: ${generated.toolResult.error || 'video shot generation failed'}`,
            error: generated.toolResult.success !== true,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_analyze_generated_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const analyzed = await creativeAnalyzeGeneratedVideo(storage, {
            source: String(args?.source || args?.video || '').trim(),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            frameCount: Number.isFinite(Number(args?.frameCount ?? args?.frame_count)) ? Number(args?.frameCount ?? args?.frame_count) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `Analyzed generated video ${analyzed.asset.name}: score ${analyzed.score}/100 (${analyzed.passed ? 'passed' : 'needs review'}).${analyzed.contactSheet ? ` Contact sheet: ${analyzed.contactSheet.path}` : ''}\n${JSON.stringify({
              score: analyzed.score,
              passed: analyzed.passed,
              warnings: analyzed.warnings,
              recommendations: analyzed.recommendations,
              contactSheet: analyzed.contactSheet,
              bestFrames: analyzed.frames.slice(0, 3),
            }).slice(0, 8000)}`,
            error: false,
            data: analyzed,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_compare_shots': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const compared = await creativeCompareShots(storage, {
            videos: Array.isArray(args?.videos)
              ? args.videos.map((item: any) => String(item)).filter(Boolean)
              : String(args?.videos || '').split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            frameCount: Number.isFinite(Number(args?.frameCount ?? args?.frame_count)) ? Number(args?.frameCount ?? args?.frame_count) : undefined,
          });
          return {
            name,
            args,
            result: `Compared ${compared.analyses.length} shot takes. ${compared.recommendation}\n${JSON.stringify({
              winner: compared.winner ? { source: compared.winner.source, score: compared.winner.score, passed: compared.winner.passed } : null,
              analyses: compared.analyses.map((item) => ({ source: item.source, score: item.score, passed: item.passed, warnings: item.warnings })),
            }).slice(0, 9000)}`,
            error: false,
            data: compared,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_select_best_take': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const selected = await creativeSelectBestTake(storage, {
            shotId: String(args?.shotId || args?.shot_id || '').trim(),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `${selected.recommendation}\n${JSON.stringify({
              selected: selected.selected ? { generation: selected.selected.generation, score: selected.selected.score, passed: selected.selected.passed, outputPath: selected.selected.source } : null,
              analyses: selected.analyses.map((item) => ({ generationId: item.generation?.id, score: item.score, passed: item.passed, outputPath: item.source, error: item.error || null })),
            }).slice(0, 10000)}`,
            error: false,
            data: selected,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_retry_shot_until_pass': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const retried = await creativeRetryShotUntilPass(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            image: args?.image ? String(args.image) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            video: args?.video ? String(args.video) : undefined,
            mode: args?.mode ? String(args.mode) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
            pollIntervalMs: Number.isFinite(Number(args?.pollIntervalMs ?? args?.poll_interval_ms)) ? Number(args?.pollIntervalMs ?? args?.poll_interval_ms) : undefined,
            timeoutMs: Number.isFinite(Number(args?.timeoutMs ?? args?.timeout_ms)) ? Number(args?.timeoutMs ?? args?.timeout_ms) : undefined,
            maxRetries: Number.isFinite(Number(args?.maxRetries ?? args?.max_retries)) ? Number(args?.maxRetries ?? args?.max_retries) : undefined,
            passScore: Number.isFinite(Number(args?.passScore ?? args?.pass_score)) ? Number(args?.passScore ?? args?.pass_score) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
          });
          return {
            name,
            args,
            result: `Retried video shot ${retried.attempts.length} time${retried.attempts.length === 1 ? '' : 's'}; ${retried.passed ? 'passed' : 'needs review'}. ${retried.recommendation}\n${JSON.stringify({
              selectedScore: retried.selected?.analysis?.score || null,
              selectedVideo: retried.selected?.generated?.video || null,
              attempts: retried.attempts.map((item) => ({ attempt: item.attempt, score: item.analysis?.score || null, passed: item.analysis?.passed || false, video: item.generated?.video })),
            }).slice(0, 9000)}`,
            error: retried.attempts.length === 0,
            data: retried,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_refine_video_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const refined = await creativeRefineVideoShot(storage, {
            sourceVideo: String(args?.sourceVideo || args?.source_video || args?.video || '').trim(),
            issueMode: args?.issueMode || args?.issue_mode,
            issueDescription: args?.issueDescription || args?.issue_description ? String(args.issueDescription || args.issue_description) : undefined,
            desiredCorrection: args?.desiredCorrection || args?.desired_correction ? String(args.desiredCorrection || args.desired_correction) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            keyframe: args?.keyframe ? String(args.keyframe) : undefined,
            frameStrategy: args?.frameStrategy || args?.frame_strategy,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            preserveStyle: args?.preserveStyle !== false && args?.preserve_style !== false,
            preserveCharacter: args?.preserveCharacter !== false && args?.preserve_character !== false,
            preserveLocation: args?.preserveLocation !== false && args?.preserve_location !== false,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            maxRetries: Number.isFinite(Number(args?.maxRetries ?? args?.max_retries)) ? Number(args?.maxRetries ?? args?.max_retries) : undefined,
            passScore: Number.isFinite(Number(args?.passScore ?? args?.pass_score)) ? Number(args?.passScore ?? args?.pass_score) : undefined,
          });
          return {
            name,
            args,
            result: `Refined video shot from keyframe${refined.keyframeAsset ? ` asset ${refined.keyframeAsset.id}` : ''}; ${refined.result.passed ? 'passed QA' : 'needs review'}.\n${JSON.stringify({
              prompt: refined.prompt,
              keyframe: refined.keyframe,
              keyframeAsset: refined.keyframeAsset,
              selected: refined.result.selected,
              recommendation: refined.result.recommendation,
            }).slice(0, 10000)}`,
            error: false,
            data: refined,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_sequence': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateSequence(storage, {
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            generationMode: args?.generationMode || args?.generation_mode,
            maxRetriesPerShot: Number.isFinite(Number(args?.maxRetriesPerShot ?? args?.max_retries_per_shot)) ? Number(args?.maxRetriesPerShot ?? args?.max_retries_per_shot) : undefined,
            qaThreshold: Number.isFinite(Number(args?.qaThreshold ?? args?.qa_threshold)) ? Number(args?.qaThreshold ?? args?.qa_threshold) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            dryRun: args?.dryRun === true || args?.dry_run === true,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `${generated.dryRun ? 'Planned' : 'Generated'} sequence for ${generated.storyboard.shots.length} storyboard shot${generated.storyboard.shots.length === 1 ? '' : 's'} with ${generated.failures.length} failure${generated.failures.length === 1 ? '' : 's'}.\n${JSON.stringify({
              projectId: generated.project?.id || null,
              storyboardId: generated.storyboard.id,
              results: generated.shotResults.map((item) => ({ shotId: item.shotId || item.shot?.shotId, videoPath: item.videoPath || null, passed: item.passed ?? null, error: item.error || null, plan: item.plan })),
              failures: generated.failures,
            }).slice(0, 12000)}`,
            error: false,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_layers_for_generation': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const sourceInput = resolveCreativeToolSource(storage, args || {}, 'creative_extract_layers_for_generation', 'source image');
          if (!sourceInput.source) {
            return { name, args, result: sourceInput.error || 'creative_extract_layers_for_generation requires a source image.', error: true };
          }
          const extracted = await creativeExtractLayersForGeneration(storage, {
            source: sourceInput.source,
            prompt: args?.prompt ? String(args.prompt) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            mode: args?.mode,
            textEditable: args?.textEditable === true,
            extractObjects: args?.extractObjects !== false,
            maxTextLayers: Number(args?.maxTextLayers) || undefined,
            maxShapeLayers: Number(args?.maxShapeLayers) || undefined,
            useVision: args?.useVision !== false,
            useOcr: args?.useOcr === true,
            useSam: args?.useSam !== false,
            inpaintBackground: args?.inpaintBackground !== false,
            vectorTraceShapes: args?.vectorTraceShapes !== false,
            saveLayerAssets: args?.saveLayerAssets === true || args?.autoSaveLayerAssets === true,
            layerAssetBatchName: args?.layerAssetBatchName ? String(args.layerAssetBatchName) : undefined,
          });
          return {
            name,
            args,
            result: `Extracted ${extracted.extraction.layers.length} layer${extracted.extraction.layers.length === 1 ? '' : 's'} and registered ${extracted.registeredLayers.length} reusable layer generation record${extracted.registeredLayers.length === 1 ? '' : 's'}${extracted.extraction.savedLayerAssets ? `; saved ${extracted.extraction.savedLayerAssets.count} layer PNG asset${extracted.extraction.savedLayerAssets.count === 1 ? '' : 's'} to ${extracted.extraction.savedLayerAssets.directory}` : ''}.\n${JSON.stringify({
              generation: extracted.generation,
              scenePath: extracted.extraction.scenePath,
              registeredLayers: extracted.registeredLayers,
              savedLayerAssets: extracted.extraction.savedLayerAssets || null,
              diagnostics: extracted.extraction.diagnostics,
            }).slice(0, 9000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_pick_continuity_frame': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const picked = await creativePickContinuityFrame(storage, {
            source: String(args?.source || args?.video || '').trim(),
            strategy: args?.strategy,
            candidatePercents: Array.isArray(args?.candidatePercents || args?.candidate_percents)
              ? (args.candidatePercents || args.candidate_percents).map((item: any) => Number(item)).filter(Number.isFinite)
              : undefined,
            registerAsAsset: args?.registerAsAsset !== false && args?.register_as_asset !== false,
            continuityPrompt: args?.continuityPrompt || args?.continuity_prompt ? String(args.continuityPrompt || args.continuity_prompt) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `Selected continuity frame ${picked.selected?.path || picked.selected?.outputPath || ''}${picked.asset ? ` and imported asset ${picked.asset.id}` : ''}.\n${JSON.stringify({
              selected: picked.selected,
              asset: picked.asset,
              contactSheet: picked.contactSheet,
              candidateCount: picked.candidates.length,
              vision: picked.vision,
            }).slice(0, 7000)}`,
            error: false,
            data: picked,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_chain_scene': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const chained = await creativeChainScene(storage, {
            previousVideo: String(args?.previousVideo || args?.previous_video || args?.source || '').trim(),
            nextPrompt: String(args?.nextPrompt || args?.next_prompt || args?.prompt || '').trim(),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            frameStrategy: args?.frameStrategy || args?.frame_strategy,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            stitch: args?.stitch === true,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
          });
          return {
            name,
            args,
            result: `Chained scene${chained.shot?.generation ? ` ${chained.shot.generation.id}` : ''} from continuity frame${chained.continuityAsset ? ` ${chained.continuityAsset.id}` : ''}.\n${JSON.stringify({
              continuityFrame: chained.continuityFrame,
              continuityAsset: chained.continuityAsset,
              video: chained.shot?.video,
              asset: chained.shot?.asset,
              generation: chained.shot?.generation,
              stitched: chained.stitched,
            }).slice(0, 9000)}`,
            error: false,
            data: chained,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_wrap_video_as_html_motion_clip': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const wrapped = await creativeWrapVideoAsHtmlMotionClip(storage, {
            source: String(args?.source || args?.video || '').trim(),
            title: args?.title ? String(args.title) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            filename: args?.filename ? String(args.filename) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          return {
            name,
            args,
            result: `Wrapped video as HTML Motion clip ${wrapped.clipPath}.\n${JSON.stringify({
              clipPath: wrapped.clipPath,
              asset: wrapped.asset,
              durationMs: wrapped.durationMs,
              width: wrapped.width,
              height: wrapped.height,
            }).slice(0, 5000)}`,
            error: false,
            data: wrapped,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_generated_clip_to_composition': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const wrapped = await creativeWrapVideoAsHtmlMotionClip(storage, {
            source: String(args?.source || args?.video || '').trim(),
            title: args?.title ? String(args.title) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          const placement = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'composition_add_clip',
            payload: {
              trackId: args?.trackId || args?.track_id ? String(args.trackId || args.track_id) : undefined,
              lane: 'html-motion',
              source: { kind: 'html-motion', clipPath: wrapped.clipPath, compositionId: wrapped.asset.id },
              atMs: Number.isFinite(Number(args?.atMs ?? args?.at_ms)) ? Number(args?.atMs ?? args?.at_ms) : undefined,
              durationMs: wrapped.durationMs,
              label: args?.label ? String(args.label) : (wrapped.asset.name || 'Generated video clip'),
              ripple: args?.ripple === true,
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_composition_add_clip'),
          });
          return {
            name,
            args,
            result: placement.success
              ? `Added generated video clip to composition via ${wrapped.clipPath}.`
              : `Wrapped clip, but composition placement failed: ${placement.error || 'unknown editor error'}`,
            error: !placement.success,
            data: { wrapped, placement },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_render_generated_sequence': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawVideos = Array.isArray(args?.videos)
            ? args.videos
            : String(args?.videos || args?.source || '').split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean);
          const rendered = await creativeRenderGeneratedSequence(storage, {
            videos: rawVideos.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            audioHandling: args?.audioHandling || args?.audio_handling,
            renderMode: args?.renderMode || args?.render_mode,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && rendered.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: rendered.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: rendered.composition?.durationMs || undefined,
                meta: { generatedSequence: true },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Rendered generated sequence to ${rendered.outputRelPath}.\n${JSON.stringify({
              outputPath: rendered.outputRelPath,
              clipCount: rendered.clips.length,
              render: rendered.render,
            }).slice(0, 6000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_stitch_clips': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawClips = Array.isArray(args?.clips)
            ? args.clips
            : String(args?.clips || args?.videos || '').split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean);
          const stitched = await creativeStitchClips(storage, {
            clips: rawClips.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            audioHandling: args?.audioHandling || args?.audio_handling,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && stitched.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: stitched.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: Number(stitched.asset?.durationMs || 0) || undefined,
                meta: { stitched: true },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Stitched ${stitched.clipPlan.length} clip${stitched.clipPlan.length === 1 ? '' : 's'} to ${stitched.outputRelPath}.\n${JSON.stringify(stitched).slice(0, 9000)}`,
            error: false,
            data: stitched,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_auto_assemble_rough_cut': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawVideos = Array.isArray(args?.videos) ? args.videos : [];
          const assembled = await creativeAutoAssembleRoughCut(storage, {
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            selectedTakes: args?.selectedTakes || args?.selected_takes,
            videos: rawVideos.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              shotId: item?.shotId || item?.shot_id ? String(item.shotId || item.shot_id) : undefined,
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            defaultTrimStartMs: Number.isFinite(Number(args?.defaultTrimStartMs ?? args?.default_trim_start_ms)) ? Number(args?.defaultTrimStartMs ?? args?.default_trim_start_ms) : undefined,
            defaultTrimEndMs: Number.isFinite(Number(args?.defaultTrimEndMs ?? args?.default_trim_end_ms)) ? Number(args?.defaultTrimEndMs ?? args?.default_trim_end_ms) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            audioHandling: args?.audioHandling || args?.audio_handling,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && assembled.stitched?.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: assembled.stitched.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: Number(assembled.stitched.asset?.durationMs || 0) || undefined,
                meta: { roughCut: true, timelinePath: assembled.timeline?.path || null },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Assembled rough cut ${assembled.stitched.outputRelPath} with ${assembled.timeline.clips.length} clip${assembled.timeline.clips.length === 1 ? '' : 's'}; timeline ${assembled.timeline.path}.\n${JSON.stringify({
              outputPath: assembled.stitched.outputRelPath,
              timelinePath: assembled.timeline.path,
              transition: assembled.stitched.ffmpeg,
              projectId: assembled.project?.id || null,
            }).slice(0, 9000)}`,
            error: false,
            data: assembled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_normalize_layer_specs': {
        try {
          const normalized = creativeNormalizeLayerSpecs({
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
          });
          return {
            name,
            args,
            result: `Normalized ${normalized.layers.length} layer spec${normalized.layers.length === 1 ? '' : 's'} for ${normalized.width}x${normalized.height}, ${normalized.durationMs}ms.`,
            error: false,
            data: normalized,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_validate_composition_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const validation = creativeValidateCompositionLayers(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            strict: args?.strict === true,
          });
          return {
            name,
            args,
            result: `${validation.ok ? 'Layer validation passed' : 'Layer validation failed'} with ${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}; complexity ${validation.complexityScore}.\n${JSON.stringify({ issues: validation.issues, normalized: validation.normalized }).slice(0, 12000)}`,
            error: !validation.ok,
            data: validation,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_preflight_overlay': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const preflight = await creativePreflightOverlay(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            strict: args?.strict === true,
            writePreview: args?.writePreview !== false && args?.write_preview !== false,
          });
          return {
            name,
            args,
            result: `${preflight.ok ? 'Overlay preflight passed' : 'Overlay preflight failed'} with ${preflight.issues.length} issue${preflight.issues.length === 1 ? '' : 's'}${preflight.previewPath ? `; preview ${preflight.previewPath}` : ''}.\n${JSON.stringify({ issues: preflight.issues, previewPath: preflight.previewPath, complexityScore: preflight.complexityScore }).slice(0, 9000)}`,
            error: !preflight.ok,
            data: preflight,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sample_composite_frames': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const sampled = await creativeSampleCompositeFrames(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            timestampsMs: Array.isArray(args?.timestampsMs || args?.timestamps_ms)
              ? (args.timestampsMs || args.timestamps_ms).map((item: any) => Number(item)).filter(Number.isFinite)
              : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
          });
          return {
            name,
            args,
            result: `Sampled ${sampled.frames.length} composite frame${sampled.frames.length === 1 ? '' : 's'}${sampled.contactSheet ? ` with contact sheet ${sampled.contactSheet.path}` : ''}.\n${JSON.stringify({ ok: sampled.ok, issues: sampled.issues, frames: sampled.frames, previewPath: sampled.previewPath, contactSheet: sampled.contactSheet }).slice(0, 10000)}`,
            error: !sampled.ok,
            data: sampled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_motion_graphics_layer': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateMotionGraphicsLayer(storage, {
            mode: args?.mode,
            text: args?.text ? String(args.text) : undefined,
            secondaryText: args?.secondaryText || args?.secondary_text ? String(args.secondaryText || args.secondary_text) : undefined,
            accentColor: args?.accentColor || args?.accent_color ? String(args.accentColor || args.accent_color) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            targetRegion: args?.targetRegion || args?.target_region,
            data: args?.data && typeof args.data === 'object' ? args.data : undefined,
            asset: args?.asset ? String(args.asset) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            sample: args?.sample !== false,
          });
          return {
            name,
            args,
            result: `Generated editable motion graphics layer ${generated.htmlPath}${generated.samples?.contactSheet ? `; contact sheet ${generated.samples.contactSheet.path}` : ''}.\n${JSON.stringify({ layer: generated.layer, htmlPath: generated.htmlPath, slots: generated.slots, issues: generated.preflight.issues, samples: generated.samples }).slice(0, 10000)}`,
            error: false,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_overlay_hyperframes_on_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rendered = await creativeOverlayHyperframesOnVideo(storage, {
            baseVideo: String(args?.baseVideo || args?.base_video || args?.video || '').trim(),
            overlayHtml: args?.overlayHtml || args?.overlay_html ? String(args.overlayHtml || args.overlay_html) : undefined,
            overlayPath: args?.overlayPath || args?.overlay_path ? String(args.overlayPath || args.overlay_path) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            position: args?.position,
            bounds: args?.bounds,
            blendMode: args?.blendMode || args?.blend_mode,
            opacity: Number.isFinite(Number(args?.opacity)) ? Number(args.opacity) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            outputFilename: args?.outputFilename || args?.output_filename || args?.filename ? String(args.outputFilename || args.output_filename || args.filename) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            sampleBeforeRender: args?.sampleBeforeRender !== false && args?.sample_before_render !== false,
          });
          return {
            name,
            args,
            result: `Rendered overlay video to ${rendered.outputRelPath}; manifest ${rendered.compositionPath}.\n${JSON.stringify({ outputPath: rendered.outputRelPath, compositionPath: rendered.compositionPath, asset: rendered.asset, issues: rendered.preflight.issues, samples: rendered.samples }).slice(0, 10000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_composite_video_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rendered = await creativeCompositeVideoLayers(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            sampleBeforeRender: args?.sampleBeforeRender !== false && args?.sample_before_render !== false,
            strict: args?.strict !== false,
            audioLayer: args?.audioLayer || args?.audio_layer,
          });
          return {
            name,
            args,
            result: `Rendered composite video to ${rendered.outputRelPath}; manifest ${rendered.compositionPath}.\n${JSON.stringify({ outputPath: rendered.outputRelPath, compositionPath: rendered.compositionPath, asset: rendered.asset, issues: rendered.preflight.issues, samples: rendered.samples }).slice(0, 10000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_import_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const imported = await creativeImportAudio(storage, {
            source: String(args?.source || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            copy: args?.copy !== false,
          });
          return { name, args, result: `Imported audio ${imported.audioTrack.source}; generation ${imported.generation.id}.\n${JSON.stringify({ asset: imported.asset, audioTrack: imported.audioTrack, analysis: imported.analysis, projectId: imported.project?.id || null }).slice(0, 10000)}`, error: false, data: imported };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_download_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const downloaded = await creativeDownloadAudio(storage, {
            url: String(args?.url || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
          });
          return { name, args, result: `Downloaded audio to ${downloaded.audioTrack.source}; generation ${downloaded.generation.id}.\n${JSON.stringify({ download: downloaded.download, asset: downloaded.asset, audioTrack: downloaded.audioTrack, projectId: downloaded.project?.id || null }).slice(0, 10000)}`, error: false, data: downloaded };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_audio_from_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractAudioFromVideo(storage, {
            source: String(args?.source || args?.video || '').trim(),
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'wav' ? 'wav' : args?.format === 'm4a' ? 'm4a' : 'mp3',
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
          });
          return { name, args, result: `Extracted audio to ${extracted.outputPath}; generation ${extracted.generation.id}.\n${JSON.stringify({ asset: extracted.asset, audioTrack: extracted.audioTrack, analysis: extracted.analysis, projectId: extracted.project?.id || null }).slice(0, 10000)}`, error: false, data: extracted };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_voiceover': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateVoiceover(storage, {
            text: String(args?.text || args?.script || '').trim(),
            provider: args?.provider === 'xai'
              ? 'xai'
              : args?.provider === 'openai_realtime'
                ? 'openai_realtime'
                : args?.provider === 'openai'
                  ? 'openai'
                  : 'auto',
            voice: args?.voice || args?.voiceId || args?.voice_id ? String(args.voice || args.voiceId || args.voice_id) : undefined,
            language: args?.language ? String(args.language) : undefined,
            speed: Number.isFinite(Number(args?.speed)) ? Number(args.speed) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            tags: args?.tags,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && generated.outputPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: generated.outputPath,
                type: 'audio',
                assetType: 'audio',
                durationMs: Number(generated.asset?.durationMs || generated.audioTrack?.durationMs || 0) || undefined,
                volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1,
                meta: {
                  voiceover: true,
                  generationId: generated.generation?.id || null,
                  shotId: args?.shotId || args?.shot_id || null,
                },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return { name, args, result: `Generated voiceover ${generated.outputPath}; generation ${generated.generation.id}.\n${JSON.stringify({ asset: generated.asset, audioTrack: generated.audioTrack, analysis: generated.analysis, projectId: generated.project?.id || null }).slice(0, 10000)}`, error: false, data: generated };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_transcribe_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const transcribed = await creativeTranscribeAudio(storage, {
            source: String(args?.source || '').trim(),
            provider: args?.provider === 'xai' ? 'xai' : 'openai',
            language: args?.language ? String(args.language) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
          });
          return { name, args, result: `Transcribed audio with ${transcribed.provider}; text length ${transcribed.text.length}.\n${JSON.stringify({ provider: transcribed.provider, text: transcribed.text, analysis: transcribed.analysis }).slice(0, 10000)}`, error: false, data: transcribed };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sync_captions_to_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const captions = await creativeSyncCaptionsToAudio(storage, {
            transcript: args?.transcript || args?.text ? String(args.transcript || args.text) : undefined,
            segments: Array.isArray(args?.segments) ? args.segments : undefined,
            audioSource: args?.audioSource || args?.audio_source ? String(args.audioSource || args.audio_source) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args.durationMs ?? args.duration_ms) : undefined,
            style: args?.style ? String(args.style) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Created synced caption layer ${captions.htmlPath} with ${captions.segments.length} segment${captions.segments.length === 1 ? '' : 's'}.\n${JSON.stringify({ layer: captions.layer, htmlPath: captions.htmlPath, segments: captions.segments, projectId: captions.project?.id || null, samples: captions.samples }).slice(0, 10000)}`, error: false, data: captions };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_audio_track': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const added = await creativeAddAudioTrack(storage, {
            source: String(args?.source || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args.startMs ?? args.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args.durationMs ?? args.duration_ms) : undefined,
            trimStartMs: Number.isFinite(Number(args?.trimStartMs ?? args?.trim_start_ms)) ? Number(args.trimStartMs ?? args.trim_start_ms) : undefined,
            trimEndMs: Number.isFinite(Number(args?.trimEndMs ?? args?.trim_end_ms)) ? Number(args.trimEndMs ?? args.trim_end_ms) : undefined,
            volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : undefined,
            muted: args?.muted === true,
            fadeInMs: Number.isFinite(Number(args?.fadeInMs ?? args?.fade_in_ms)) ? Number(args.fadeInMs ?? args.fade_in_ms) : undefined,
            fadeOutMs: Number.isFinite(Number(args?.fadeOutMs ?? args?.fade_out_ms)) ? Number(args.fadeOutMs ?? args.fade_out_ms) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Prepared audio track ${added.audioTrack.source}${added.project ? ` for project ${added.project.id}` : ''}.\n${JSON.stringify({ audioTrack: added.audioTrack, projectId: added.project?.id || null }).slice(0, 10000)}`, error: false, data: added };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_mix_audio_tracks': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const mixed = await creativeMixAudioTracks(storage, {
            tracks: Array.isArray(args?.tracks) ? args.tracks : [],
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'wav' ? 'wav' : args?.format === 'm4a' ? 'm4a' : 'mp3',
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Mixed audio to ${mixed.outputPath}.\n${JSON.stringify({ outputPath: mixed.outputPath, audioTrack: mixed.audioTrack, asset: mixed.asset, projectId: mixed.project?.id || null }).slice(0, 10000)}`, error: false, data: mixed };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_music_bed': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const music = await creativeAddMusicBed(storage, {
            source: args?.source ? String(args.source) : undefined,
            url: args?.url ? String(args.url) : undefined,
            volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : undefined,
            fadeInMs: Number.isFinite(Number(args?.fadeInMs ?? args?.fade_in_ms)) ? Number(args.fadeInMs ?? args.fade_in_ms) : undefined,
            fadeOutMs: Number.isFinite(Number(args?.fadeOutMs ?? args?.fade_out_ms)) ? Number(args.fadeOutMs ?? args.fade_out_ms) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            label: args?.label ? String(args.label) : undefined,
          });
          return { name, args, result: `Added music bed ${music.audioTrack.source}.\n${JSON.stringify({ audioTrack: music.audioTrack, asset: music.asset, projectId: music.project?.id || null }).slice(0, 10000)}`, error: false, data: music };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_sound_effects': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const sfx = await creativeAddSoundEffects(storage, {
            effects: Array.isArray(args?.effects) ? args.effects : [],
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            mix: args?.mix !== false,
            filename: args?.filename ? String(args.filename) : undefined,
          });
          return { name, args, result: `Added ${sfx.tracks.length} sound effect track${sfx.tracks.length === 1 ? '' : 's'}${sfx.mix ? ` and mixed to ${sfx.mix.outputPath}` : ''}.\n${JSON.stringify({ tracks: sfx.tracks, mix: sfx.mix, projectId: sfx.project?.id || null }).slice(0, 10000)}`, error: false, data: sfx };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_model_status': {
        try {
          const models = getCreativeModelPaths().listCreativeModelStatus();
          const lines = models.map((model: any) => {
            const size = typeof model.sizeBytes === 'number' ? `${(model.sizeBytes / 1e6).toFixed(1)}MB` : 'missing';
            const candidateCount = Array.isArray(model.candidates) ? model.candidates.length : 0;
            return `${model.key}: ${model.available ? 'available' : 'missing'} (${size}) -> ${model.path} (${candidateCount} candidate${candidateCount === 1 ? '' : 's'})`;
          });
          return {
            name,
            args,
            result: `Creative model status:\n${lines.join('\n')}\n\n${JSON.stringify({ models }, null, 2).slice(0, 12000)}`,
            error: false,
            data: { models },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let extraction;
        try {
          const sourceInput = resolveCreativeToolSource(storage, args || {}, 'creative_extract_layers', 'source image');
          if (!sourceInput.source) {
            return { name, args, result: sourceInput.error || 'creative_extract_layers requires a source image.', error: true };
          }
          extraction = await getCreativeLayerExtraction().extractCreativeLayers(storage, {
            source: sourceInput.source,
            mode: args?.mode,
            prompt: args?.prompt ? String(args.prompt) : undefined,
            textEditable: args?.textEditable === true,
            extractObjects: args?.extractObjects !== false,
            preserveOriginal: args?.preserveOriginal !== false,
            copySource: args?.copySource !== false,
            maxTextLayers: Number(args?.maxTextLayers) || undefined,
            maxShapeLayers: Number(args?.maxShapeLayers) || undefined,
            useVision: args?.useVision !== false,
            useOcr: args?.useOcr === true,
            useSam: args?.useSam !== false,
            inpaintBackground: args?.inpaintBackground !== false,
            vectorTraceShapes: args?.vectorTraceShapes !== false,
            saveLayerAssets: args?.saveLayerAssets === true || args?.autoSaveLayerAssets === true,
            layerAssetBatchName: args?.layerAssetBatchName ? String(args.layerAssetBatchName) : undefined,
          });
        } catch (err: any) {
          return {
            name,
            args,
            result: `creative_extract_layers: ${String(err?.message || err || 'layer extraction failed')}`,
            error: true,
          };
        }

        const applyToScene = args?.applyToScene !== false;
        const replaceScene = args?.replaceScene !== false;
        const creativeMode = getCreativeMode(sessionId);
        let applyResult: any = null;
        let resetResult: any = null;
        if (applyToScene && (creativeMode === 'image' || creativeMode === 'canvas')) {
          if (replaceScene) {
            resetResult = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'reset_scene',
              payload: { force: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_reset_scene'),
            });
          }
          if (!replaceScene || resetResult?.success) {
            applyResult = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'apply_ops',
              payload: {
                ops: extraction.ops,
                reason: 'Apply extracted editable layers from a flat raster image.',
              },
              timeoutMs: 60000,
            });
          }
        }

        const applied = !!applyResult?.success;
        const layerCounts = {
          total: extraction.scene.elements.length,
          text: extraction.scene.elements.filter((element: any) => element?.type === 'text').length,
          shape: extraction.scene.elements.filter((element: any) => element?.type === 'shape').length,
          image: extraction.scene.elements.filter((element: any) => element?.type === 'image').length,
        };
        const applyNote = !applyToScene
          ? 'Scene application skipped by applyToScene=false.'
          : applied
            ? 'Extracted scene was applied to the active Image workspace.'
            : creativeMode === 'image' || creativeMode === 'canvas'
              ? `Scene was extracted but not applied: ${applyResult?.error || resetResult?.error || 'creative editor did not accept the command.'}`
          : 'Scene was extracted but not applied because an image workspace is not selected.';
        const savedLayerAssets = extraction.savedLayerAssets || null;
        const savedLayerNote = savedLayerAssets
          ? `Saved ${savedLayerAssets.count} separate layer PNG asset${savedLayerAssets.count === 1 ? '' : 's'}: ${savedLayerAssets.directory}`
          : (args?.saveLayerAssets === true || args?.autoSaveLayerAssets === true)
            ? 'Layer asset auto-save was requested, but no separate PNG assets were saved.'
            : '';
        return {
          name,
          args,
          result: [
            `Extracted ${layerCounts.total} editable layer${layerCounts.total === 1 ? '' : 's'} from ${extraction.source.name}.`,
            `Saved scene: ${extraction.scenePath}`,
            savedLayerNote,
            applyNote,
            extraction.diagnostics.warnings.length ? `Warnings: ${extraction.diagnostics.warnings.join(' | ')}` : '',
          ].filter(Boolean).join('\n'),
          error: false,
          data: {
            ...extraction,
            applied,
            applyResult,
            resetResult,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
            layerCounts,
          },
        };
      }

      case 'creative_list_html_motion_templates': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const templates = summarizeHtmlMotionTemplates(storage);
        return {
          name,
          args,
          result: `${name}: ${templates.length} HTML motion templates available.\n${JSON.stringify({ templates }).slice(0, 4000)}`,
          error: false,
          data: { templates },
        };
      }

      case 'creative_list_hyperframes_components': {
        const components = getHyperframesCatalog().listHyperframesCatalogItems({
          query: args?.query,
          kind: args?.kind,
          tag: args?.tag,
        });
        return {
          name,
          args,
          result: `${name}: ${components.length} HyperFrames catalog component${components.length === 1 ? '' : 's'} available.\n${JSON.stringify({ components }).slice(0, 5000)}`,
          error: false,
          data: { components },
        };
      }

      case 'creative_import_hyperframes_component': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const componentId = String(args?.componentId || args?.id || '').trim();
        if (!componentId) {
          return { name, args, result: `${name}: componentId is required.`, error: true };
        }
        try {
          const imported = await getHyperframesCatalog().importHyperframesComponent(storage, componentId);
          const saved = imported.template || imported.block;
          return {
            name,
            args,
            result: `${name}: imported HyperFrames ${imported.item.name} as ${imported.importedAs} ${saved?.id || ''} with ${imported.assets.length} asset reference${imported.assets.length === 1 ? '' : 's'}.\n${JSON.stringify({
              importedAs: imported.importedAs,
              template: imported.template,
              block: imported.block,
              assets: imported.assets,
              warnings: imported.warnings,
            }).slice(0, 5000)}`,
            error: false,
            data: imported,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sync_hyperframes_catalog': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const rawIds = Array.isArray(args?.ids)
          ? args.ids
          : typeof args?.ids === 'string'
            ? String(args.ids).split(',').map((part) => part.trim()).filter(Boolean)
            : [];
        try {
          const synced = await getHyperframesCatalog().importHyperframesCatalog(storage, {
            ids: rawIds,
            query: args?.query,
            limit: Number(args?.limit) || undefined,
            live: args?.live === true,
          });
          const templates = synced.imported.filter((entry) => entry.importedAs === 'template').length;
          const blocks = synced.imported.filter((entry) => entry.importedAs === 'block').length;
          return {
            name,
            args,
            result: `${name}: imported ${synced.imported.length}/${synced.selectedCount} HyperFrames component${synced.selectedCount === 1 ? '' : 's'} (${templates} templates, ${blocks} blocks). ${synced.failed.length ? `${synced.failed.length} failed.` : 'No failures.'}\n${JSON.stringify({
              catalogCount: synced.catalogCount,
              selectedCount: synced.selectedCount,
              imported: synced.imported.map((entry) => ({
                id: entry.item.id,
                name: entry.item.name,
                importedAs: entry.importedAs,
                savedId: entry.template?.id || entry.block?.id,
                assetCount: entry.assets.length,
                warnings: entry.warnings,
              })),
              failed: synced.failed,
            }).slice(0, 7000)}`,
            error: synced.imported.length === 0 && synced.failed.length > 0,
            data: synced,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_list_library_packs': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const payload = buildCreativeLibraryPayload(storage);
        const includeElements = args?.includeElements === true;
        const libraries = includeElements
          ? payload.libraries
          : payload.libraries.map(({ elements, animationPresets, ...library }) => ({
              ...library,
              elementCount: Object.values(elements || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0),
              animationPresetCount: Array.isArray(animationPresets) ? animationPresets.length : 0,
            }));
        return {
          name,
          args,
          result: `${name}: ${libraries.length} creative library packs available (${payload.enabledLibraryIds.length} enabled).\n${JSON.stringify({ libraries, enabledLibraryIds: payload.enabledLibraryIds }).slice(0, 5000)}`,
          error: false,
          data: { ...payload, libraries },
        };
      }

      case 'creative_create_library_pack': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const manifest = args?.pack && typeof args.pack === 'object' && !Array.isArray(args.pack)
            ? args.pack
            : args;
          const created = createCreativeLibraryPack(storage, manifest, args?.enabled !== false);
          return {
            name,
            args,
            result: `${name}: saved custom creative library pack ${created.pack.label} (${created.pack.id}) and ${created.pack.enabled ? 'enabled' : 'disabled'} it.\n${JSON.stringify({ pack: created.pack, enabledLibraryIds: created.payload.enabledLibraryIds }).slice(0, 4000)}`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_toggle_library_pack': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const libraryId = String(args?.libraryId || args?.id || '').trim();
          const enabled = args?.enabled !== false;
          const toggled = toggleCreativeLibraryPack(storage, libraryId, enabled);
          return {
            name,
            args,
            result: `${name}: ${enabled ? 'enabled' : 'disabled'} creative library pack ${toggled.libraryId}.\n${JSON.stringify({ enabledLibraryIds: toggled.payload.enabledLibraryIds }).slice(0, 3000)}`,
            error: false,
            data: toggled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_save_html_motion_template': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        let activeClip: any = null;
        if (!html.trim() && args?.useActiveClip !== false) {
          const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
          const read = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'read_html_motion_clip',
            payload: { includeHtml: true },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
          });
          const readAny: any = read;
          if (read.success) {
            activeClip = readAny.data?.clip || readAny.clip || null;
            html = String(readAny.data?.clip?.html || readAny.clip?.html || readAny.data?.html || '');
          }
        }
        if (!html.trim()) {
          return { name, args, result: `${name}: html is required unless an active HTML motion clip can be read.`, error: true };
        }
        try {
          const template = saveCustomHtmlMotionTemplate(storage, {
            ...args,
            html,
            name: args?.name || args?.title || activeClip?.title,
            width: args?.width || activeClip?.width,
            height: args?.height || activeClip?.height,
            durationMs: args?.durationMs || activeClip?.durationMs,
            frameRate: args?.frameRate || activeClip?.frameRate,
          });
          return {
            name,
            args,
            result: `${name}: saved custom HTML motion template ${template.name} (${template.id}).\n${JSON.stringify({ template }).slice(0, 4000)}`,
            error: false,
            data: { template },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_save_html_motion_block': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const block = saveCustomHtmlMotionBlock(storage, args?.block && typeof args.block === 'object' && !Array.isArray(args.block) ? args.block : args);
          return {
            name,
            args,
            result: `${name}: saved custom HTML motion block ${block.name} (${block.id}).\n${JSON.stringify({ block }).slice(0, 4000)}`,
            error: false,
            data: { block },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_promote_scene_to_template': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const currentCreativeMode = getCreativeMode(sessionId);
        const creativeMode = currentCreativeMode && currentCreativeMode !== 'design'
          ? currentCreativeMode
          : (setCreativeMode(sessionId, 'image') || 'image');
        try {
          const save = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'save_scene',
            payload: { filename: `${String(args?.id || args?.name || 'promoted-scene').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'promoted-scene'}.json` },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_save_scene'),
          });
          if (!save.success) {
            return { name, args, result: `${name}: ${save.error || 'could not save the active scene before promoting it.'}`, error: true };
          }
          const saveAny: any = save;
          const savedPath = String(saveAny.data?.path || saveAny.path || '');
          if (!savedPath) {
            return { name, args, result: `${name}: editor saved the scene but did not return a workspace path.`, error: true, data: save };
          }
          const savedAbsPath = resolveWorkspaceFilePath(storage.workspacePath, savedPath);
          const parsed = JSON.parse(fs.readFileSync(savedAbsPath, 'utf-8'));
          const scene = parsed?.doc || parsed?.scene || parsed;
          const template = saveCustomSceneTemplate(storage, {
            ...args,
            scene,
            category: args?.category || creativeMode,
          });
          let htmlTemplate: any = null;
          if (creativeMode === 'video' && args?.saveHtmlTemplate === true) {
            const read = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
            });
            const readAny: any = read;
            const html = read.success ? String(readAny.data?.clip?.html || readAny.clip?.html || readAny.data?.html || '') : '';
            if (html.trim()) {
              htmlTemplate = saveCustomHtmlMotionTemplate(storage, {
                id: `${template.id}-html-motion`,
                name: `${template.name} HTML Motion`,
                description: args?.description || template.description,
                bestFor: args?.bestFor || template.bestFor,
                html,
                width: template.width,
                height: template.height,
                durationMs: template.durationMs,
                frameRate: template.frameRate,
              });
            }
          }
          return {
            name,
            args,
            result: `${name}: promoted active ${creativeMode} scene to custom template ${template.name} (${template.id}).\n${JSON.stringify({ template, htmlTemplate }).slice(0, 5000)}`,
            error: false,
            data: { template, htmlTemplate, sourceScenePath: savedPath },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_lint_html_motion_clip': {
        const html = typeof args?.html === 'string' ? String(args.html) : '';
        if (!html.trim()) {
          const creativeMode = getCreativeMode(sessionId);
          if (creativeMode && creativeMode !== 'design') {
            const result = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: {
                ...(args || {}),
                includeHtml: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs(name),
            });
            if (result.success) {
              const resultAny: any = result;
              const lint = resultAny.data?.clip?.lint || resultAny.clip?.lint || resultAny.data?.lint || resultAny.lint;
              return {
                name,
                args,
                result: `${name}: ${lint?.ok === false ? 'blocked' : 'ok'} (${Number(lint?.errorCount || 0)} errors, ${Number(lint?.warningCount || 0)} warnings).\n${JSON.stringify(lint || result.data || result).slice(0, 5000)}`,
                error: false,
                data: lint || result.data || result,
              };
            }
          }
          return {
            name,
            args,
            result: `${name}: provide html/path to lint directly, or keep an active HTML motion clip selected before linting.`,
            error: true,
          };
        }
        const lint = lintHtmlMotionComposition(html, args?.manifest && typeof args.manifest === 'object' ? args.manifest : args);
        return {
          name,
          args,
          result: `${name}: ${lint.ok ? 'ok' : 'blocked'} (${lint.errorCount} errors, ${lint.warningCount} warnings).\n${JSON.stringify(lint).slice(0, 5000)}`,
          error: false,
          data: lint,
        };
      }

      case 'creative_measure_text': {
        const text = String(args?.text ?? '');
        const width = Number(args?.width);
        if (!Number.isFinite(width) || width <= 0) {
          return { name, args, result: `${name}: width (px) is required.`, error: true };
        }
        try {
          const fit = checkTextFit(text, {
            width,
            maxHeight: Number.isFinite(Number(args?.maxHeight)) ? Number(args.maxHeight) : undefined,
            fontSize: Number(args?.fontSize) || undefined,
            fontFamily: typeof args?.fontFamily === 'string' ? args.fontFamily : undefined,
            fontWeight: typeof args?.fontWeight === 'number' || typeof args?.fontWeight === 'string' ? args.fontWeight : undefined,
            fontStyle: typeof args?.fontStyle === 'string' ? args.fontStyle : undefined,
            lineHeight: Number.isFinite(Number(args?.lineHeight)) ? Number(args.lineHeight) : undefined,
          });
          const status = fit.overflowsHeight || fit.overflowsWidth ? 'overflow' : 'fits';
          return {
            name,
            args,
            result: `${name}: ${status} (${fit.lineCount} line${fit.lineCount === 1 ? '' : 's'}, ${fit.height}px tall @ ${fit.fontSize}px${fit.suggestedFontSize ? `, try ${fit.suggestedFontSize}px to fit` : ''}).\n${JSON.stringify(fit).slice(0, 2000)}`,
            error: false,
            data: fit,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_text_fit_report': {
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        if (!html.trim()) {
          const creativeMode = getCreativeMode(sessionId);
          if (creativeMode && creativeMode !== 'design') {
            const result = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs(name),
            });
            const resultAny: any = result;
            if (result.success) {
              html = String(resultAny.data?.clip?.html || resultAny.clip?.html || resultAny.data?.html || '');
            }
          }
          if (!html.trim()) {
            return { name, args, result: `${name}: provide html or keep an active HTML motion clip selected before reporting text fit.`, error: true };
          }
        }
        try {
          const report = reportHtmlTextFit(html, {
            stageWidth: Number(args?.stageWidth) || undefined,
            stageHeight: Number(args?.stageHeight) || undefined,
          });
          return {
            name,
            args,
            result: `${name}: ${report.ok ? 'ok' : `${report.overflowCount} overflow finding(s)`} across ${report.measuredNodes} measured node(s).\n${JSON.stringify(report).slice(0, 6000)}`,
            error: false,
            data: report,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_list_html_motion_blocks': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const blocks = listHtmlMotionBlocks({
          category: args?.category,
          query: args?.query,
          packId: args?.packId,
        }, storage);
        return {
          name,
          args,
          result: `${name}: ${blocks.length} HTML motion blocks available.\n${JSON.stringify({ blocks }).slice(0, 5000)}`,
          error: false,
          data: { blocks },
        };
      }

      case 'creative_render_html_motion_block': {
        try {
          const storage = buildCreativeStorageForTool(workspacePath, sessionId);
          const rendered = renderHtmlMotionBlock(String(args?.blockId || '').trim(), args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
          return {
            name,
            args,
            result: `${name}: rendered ${rendered.block.name} (${rendered.block.id}).\n${JSON.stringify(rendered).slice(0, 5000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_browse_catalog': {
        const browse = getHyperframesCatalog().browseHyperframesCatalog({
          query: args?.query,
          kind: args?.kind,
          tag: args?.tag,
        });
        const limit = Math.max(1, Math.min(100, Number(args?.limit) || 40));
        const payload = { ...browse, items: browse.items.slice(0, limit) };
        return {
          name,
          args,
          result: `${name}: ${payload.message}\n${JSON.stringify(payload).slice(0, 6000)}`,
          error: false,
          data: payload,
        };
      }

      case 'hyperframes_insert_clip': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const catalogId = String(args?.catalogId || args?.catalog_id || args?.componentId || args?.component_id || args?.id || '').trim();
        const inputs = mergeHyperframesInputs(args);
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        let imported: any = null;
        let rendered: any = null;
        try {
          if (catalogId) {
            imported = await getHyperframesCatalog().importHyperframesComponentWithIngest(storage, storage, catalogId).catch(async () => getHyperframesCatalog().importHyperframesComponent(storage, catalogId) as any);
            if (imported.importedAs === 'block') {
              rendered = renderHtmlMotionBlock(imported.block.id, inputs, storage);
              html = wrapHyperframesBlockAsDocument(rendered, {
                ...args,
                durationMs: Number(args?.durationMs ?? args?.duration_ms) || rendered?.block?.defaultDurationMs || 6000,
                compositionId: `hyperframes-${imported.item.id}`,
              });
            } else {
              rendered = applyHtmlMotionTemplate(imported.template.id, inputs, storage);
              html = rendered.html;
            }
          }
          if (!html.trim()) {
            return { name, args, result: `${name}: provide catalogId/componentId or raw html.`, error: true };
          }
          const extraction = getHyperframesBridge().extractHyperframesLayers(html);
          const metadata = (() => {
            try { return getHyperframesBridge().parseHyperframesHtml(html).metadata; } catch { return null; }
          })();
          const width = Math.max(120, Number(args?.width) || Number(rendered?.width) || Number((metadata as any)?.resolution?.width) || 1080);
          const height = Math.max(120, Number(args?.height) || Number(rendered?.height) || Number((metadata as any)?.resolution?.height) || 1920);
          const durationMs = Math.max(100, Number(args?.durationMs ?? args?.duration_ms) || Number(rendered?.durationMs) || Number(extraction.durationMs) || 6000);
          const compositionId = extraction.compositionId || catalogId || `hyperframes-${Date.now().toString(36)}`;
          const projectSlug = sanitizeCreativeStorageSegment(compositionId, 'hyperframes-project');
          const projectDir = path.join(storage.rootAbsPath, '.prometheus', 'creative', 'hyperframes-projects', projectSlug);
          fs.mkdirSync(projectDir, { recursive: true });
          const entryFile = 'index.html';
          const entryPath = path.join(projectDir, entryFile);
          fs.writeFileSync(entryPath, getHyperframesBridge().normalizeForHyperframes(html), 'utf8');
          const projectPath = buildCreativeWorkspaceRelativePath(storage.rootAbsPath, projectDir);
          const element = {
            type: 'hyperframes',
            x: Number.isFinite(Number(args?.x)) ? Number(args.x) : 80,
            y: Number.isFinite(Number(args?.y)) ? Number(args.y) : 80,
            width,
            height,
            opacity: 1,
            zIndex: Number.isFinite(Number(args?.zIndex ?? args?.z_index)) ? Number(args?.zIndex ?? args?.z_index) : 10,
            meta: {
              html,
              compositionId,
              projectPath,
              entryFile,
              sourceFormat: 'hyperframes',
              catalogId: catalogId || null,
              advancedBlock: args?.advanced === true || args?.advancedBlock === true || extraction.advancedBlock === true,
              durationMs,
              startMs: Math.max(0, Number(args?.startMs ?? args?.start_ms) || 0),
              layers: extraction.layers,
              slots: extraction.slots,
              variables: extraction.variables,
              variableBindings: extraction.variableBindings,
              assets: Array.isArray(imported?.assets) ? imported.assets : [],
              ingest: imported?.ingest || null,
            },
          };
          const applied = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: 'video',
            command: 'apply_ops',
            payload: {
              ops: [
                ...(args?.replaceScene === true ? [{ op: 'set_canvas', width, height, durationMs }] : []),
                { op: 'add', element },
              ],
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_apply_ops'),
          });
          if (!applied.success) {
            return { name, args, result: `${name}: ${applied.error || 'creative editor command failed.'}`, error: true, data: applied };
          }
          const selected = (applied as any).selectedElement || applied.data?.selectedElement || null;
          const payload = {
            clipId: selected?.id || null,
            catalogId: catalogId || null,
            item: imported?.item || null,
            importedAs: imported?.importedAs || (catalogId ? 'unknown' : 'raw-html'),
            width,
            height,
            durationMs,
            layerCount: extraction.layers.length,
            slotCount: extraction.slots.length,
            variableCount: Array.isArray(extraction.variables) ? extraction.variables.length : 0,
            warnings: imported?.warnings || [],
            editor: applied.data || applied,
          };
          return {
            name,
            args,
            result: `${name}: inserted HyperFrames clip${payload.clipId ? ` ${payload.clipId}` : ''} (${payload.layerCount} layers, ${payload.slotCount} slots).\n${JSON.stringify(payload).slice(0, 5000)}`,
            error: false,
            data: payload,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_apply_patch':
      case 'hyperframes_set_text':
      case 'hyperframes_set_color':
      case 'hyperframes_set_timing':
      case 'hyperframes_set_variable':
      case 'hyperframes_set_asset':
      case 'hyperframes_add_animation': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
        const layerId = String(args?.layerId || args?.layer_id || args?.hfElementId || args?.hf_element_id || '').trim();
        try {
          const { clip } = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
          let ops: HyperframesPatchOp[] = Array.isArray(args?.ops) ? args.ops as HyperframesPatchOp[] : [];
          if (name === 'hyperframes_set_text') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{ op: 'set-text', elementId: layerId, text: String(args?.text ?? args?.value ?? '') }];
          } else if (name === 'hyperframes_set_color') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{ op: 'set-color', elementId: layerId, color: String(args?.color || args?.value || '') }];
          } else if (name === 'hyperframes_set_timing') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{
              op: 'set-timing',
              elementId: layerId,
              startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
              durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
              zIndex: Number.isFinite(Number(args?.zIndex ?? args?.z_index)) ? Number(args?.zIndex ?? args?.z_index) : undefined,
            }];
          } else if (name === 'hyperframes_set_variable') {
            const variableName = String(args?.name || args?.variable || args?.variableName || '').trim();
            if (!variableName) throw new Error('name/variable is required.');
            ops = [{ op: 'set-variable', name: variableName, value: args?.value }];
          } else if (name === 'hyperframes_set_asset') {
            if (!layerId) throw new Error('layerId is required.');
            const assetId = String(args?.assetId || args?.asset_id || args?.value || '').trim();
            if (!assetId) throw new Error('assetId is required.');
            ops = [{ op: 'set-asset', elementId: layerId, assetPlaceholderId: assetId }];
          } else if (name === 'hyperframes_add_animation') {
            const animation = args?.animation && typeof args.animation === 'object' ? args.animation : args;
            ops = [{ op: 'add-animation', animation } as HyperframesPatchOp];
          }
          if (!ops.length) throw new Error('ops are required.');
          const patched = await patchHyperframesClipInEditor({ deps, sessionId, creativeMode, clip, ops });
          const payload = {
            clipId: clip.id,
            warnings: patched.patched.warnings,
            layerCount: patched.extraction.layers.length,
            slotCount: patched.extraction.slots.length,
            variableCount: Array.isArray(patched.extraction.variables) ? patched.extraction.variables.length : 0,
            layers: patched.extraction.layers.slice(0, 40),
            slots: patched.extraction.slots,
            variables: patched.extraction.variables,
          };
          return {
            name,
            args,
            result: `${name}: patched HyperFrames clip ${clip.id} (${ops.length} op${ops.length === 1 ? '' : 's'}).\n${JSON.stringify(payload).slice(0, 5000)}`,
            error: false,
            data: payload,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_lint':
      case 'hyperframes_qa':
      case 'hyperframes_materialize':
      case 'hyperframes_export': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        try {
          if (name === 'hyperframes_export') {
            let html = typeof args?.html === 'string' ? String(args.html) : '';
            let clip: any = null;
            if (!html.trim()) {
              const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
              try {
                const read = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
                clip = read.clip;
                html = String(clip?.meta?.html || '');
              } catch (selectionErr: any) {
                const activeRead = await sendCreativeCommand(deps.broadcastWS, {
                  sessionId,
                  mode: creativeMode,
                  command: 'read_html_motion_clip',
                  payload: { includeHtml: true },
                  timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
                });
                const activeAny: any = activeRead;
                const activeClip = activeAny?.data?.clip || activeAny?.clip || null;
                const activeHtml = String(activeAny?.data?.clip?.html || activeAny?.clip?.html || activeAny?.data?.html || '');
                const looksMaterializedHyperframes = /data-runtime-source=["']hyperframes-core["']|data-prometheus-hyperframes-runtime|HyperFrames Materialized|data-hf-authored-duration/i
                  .test(`${activeHtml}\n${activeClip?.title || ''}\n${activeClip?.path || ''}`);
                if (activeRead.success && activeHtml.trim() && looksMaterializedHyperframes) {
                  clip = {
                    id: String(activeClip?.id || args?.clipId || args?.clip_id || 'active-html-motion-hyperframes'),
                    width: Number(activeClip?.width) || Number(args?.width) || 1080,
                    height: Number(activeClip?.height) || Number(args?.height) || 1920,
                    timing: { durationMs: Number(activeClip?.durationMs) || Number(args?.durationMs ?? args?.duration_ms) || 6000 },
                    meta: {
                      html: activeHtml,
                      compositionId: String(activeClip?.composition?.compositionId || args?.compositionId || args?.composition_id || '').trim(),
                      durationMs: Number(activeClip?.durationMs) || Number(args?.durationMs ?? args?.duration_ms) || 6000,
                      variableBindings: [],
                    },
                  };
                  html = activeHtml;
                } else {
                  throw selectionErr;
                }
              }
            }
            if (!html.trim()) {
              return { name, args, result: `${name}: selected HyperFrames clip has no HTML source to export.`, error: true };
            }
            const storage = buildCreativeStorageForTool(workspacePath, sessionId);
            const durationMs = Math.max(1000, Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || Number(clip?.timing?.durationMs) || 6000);
            const width = Math.max(320, Number(args?.width) || Number(clip?.width) || 1080);
            const height = Math.max(320, Number(args?.height) || Number(clip?.height) || 1920);
            const htmlCompositionId = /\bdata-composition-id\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2] || '';
            const compositionId = String(clip?.meta?.compositionId || args?.compositionId || args?.composition_id || htmlCompositionId || 'hyperframes-clip').trim() || 'hyperframes-clip';
            const clipId = String(clip?.id || args?.clipId || args?.clip_id || args?.elementId || args?.element_id || 'hyperframes-clip').trim();
            const formatRaw = String(args?.format || 'mp4').toLowerCase();
            const format = (['mp4', 'webm', 'mov', 'png-sequence'].includes(formatRaw) ? formatRaw : 'mp4') as any;
            const fpsRaw = Number(args?.fps ?? args?.frameRate ?? args?.frame_rate) || 30;
            const fps = ([24, 30, 60].includes(fpsRaw) ? fpsRaw : 30) as any;
            const qualityRaw = String(args?.quality || 'standard').toLowerCase();
            const quality = (['draft', 'standard', 'high'].includes(qualityRaw) ? qualityRaw : 'standard') as any;
            const requestedEngine = String(args?.renderer || args?.engine || '').toLowerCase();
            const useHtmlMotionFallback = requestedEngine === 'html-motion'
              || requestedEngine === 'html_motion'
              || args?.producer === false;
            let producerFailure: { name: string; message: string } | null = null;
            if (!useHtmlMotionFallback) {
              const safeBase = sanitizeCreativeStorageSegment(compositionId, 'hyperframes-clip');
              const extension = format === 'png-sequence' ? '' : `.${format}`;
              const filename = sanitizeCreativeStorageSegment(String(args?.filename || `${safeBase}-hyperframes${extension}`), `${safeBase}-hyperframes${extension}`);
              const outputPath = path.join(storage.rootAbsPath, '.prometheus', 'creative', 'exports', filename);
              const variables = args?.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
                ? args.variables
                : {};
              if (!Object.keys(variables).length) {
                for (const binding of Array.isArray(clip?.meta?.variableBindings) ? clip.meta.variableBindings : []) {
                  const id = String(binding?.variable?.id || '').trim();
                  if (id) (variables as any)[id] = binding.currentValue;
                }
              }
              try {
                const rendered = await getHyperframesProducer().renderHyperframesWithProducer({
                  html,
                  workspacePath: storage.rootAbsPath,
                  outputPath,
                  compositionId,
                  fps,
                  quality,
                  format,
                  workers: Math.max(1, Math.min(4, Math.round(Number(args?.workers) || 1))),
                  timeoutMs: Math.max(
                    30_000,
                    Math.min(
                      15 * 60_000,
                      Math.round(Number(args?.producerTimeoutMs ?? args?.producer_timeout_ms ?? args?.timeoutMs ?? args?.timeout_ms) || 120_000),
                    ),
                  ),
                  variables,
                  debug: args?.debug === true,
                });
                return {
                  name,
                  args,
                  result: `${name}: exported HyperFrames with @hyperframes/producer to ${buildCreativeWorkspaceRelativePath(storage.rootAbsPath, rendered.outputPath)}.\n${JSON.stringify({ outputPath: rendered.outputPath, projectDir: rendered.projectDir, job: rendered.job }).slice(0, 5000)}`,
                  error: false,
                  data: {
                    engine: '@hyperframes/producer',
                    outputPath: rendered.outputPath,
                    outputRelPath: buildCreativeWorkspaceRelativePath(storage.rootAbsPath, rendered.outputPath),
                    projectDir: rendered.projectDir,
                    entryFile: rendered.entryFile,
                    job: rendered.job,
                  },
                };
              } catch (err: any) {
                producerFailure = {
                  name: err?.name || 'HyperframesProducerError',
                  message: err?.message || String(err || 'producer render failed'),
                };
                const fallbackDisabled = args?.fallback === false
                  || args?.fallbackToHtmlMotion === false
                  || args?.fallback_to_html_motion === false;
                if (fallbackDisabled) {
                  return {
                    name,
                    args,
                    result: `${name}: @hyperframes/producer export failed: ${producerFailure.message}`,
                    error: true,
                    data: { engine: '@hyperframes/producer', producerFailure },
                  };
                }
              }
            }
            const built = getHyperframesExportAdapter().buildHyperframesRenderClip(
              { id: clipId, type: 'hyperframes', meta: { html, compositionId } },
              storage.rootAbsPath,
              {
                startMs: 0,
                endMs: durationMs,
                trimStartMs: Number(args?.trimStartMs ?? args?.trim_start_ms) || 0,
              },
            );
            const materializedHtml = fs.readFileSync(built.materialized.absClipPath, 'utf-8');
            const safeBase = compositionId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'hyperframes-clip';
            const created = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'create_html_motion_clip',
              payload: {
                title: `${compositionId} HyperFrames Export`,
                filename: `${safeBase}-hyperframes-materialized.html`,
                html: materializedHtml,
                width,
                height,
                durationMs,
                frameRate: fps,
                assets: [],
                updateScene: false,
                render: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
            });
            if (!created.success) {
              return {
                name,
                args,
                result: `${name}: materialized HyperFrames clip, but could not create exportable HTML Motion clip: ${created.error || 'unknown error'}`,
                error: true,
                data: { materialized: built, created },
              };
            }
            const createdClip = created.data?.clip || created.data?.data?.clip || created.data?.source?.clip || null;
            const exportPath = String(createdClip?.path || createdClip?.htmlPath || `${storage.rootRelPath}/prometheus-creative/html-motion/${safeBase}-hyperframes-materialized.html`);
            const exported = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'export_html_motion_clip',
              payload: {
                path: exportPath,
                format: args?.format || 'mp4',
                filename: args?.filename || `${safeBase}-hyperframes.mp4`,
                width,
                height,
                durationMs,
                frameRate: fps,
                perFrameTimeoutMs: Number(args?.perFrameTimeoutMs ?? args?.per_frame_timeout_ms) || 45_000,
                maxFrames: Number(args?.maxFrames ?? args?.max_frames) || undefined,
                forceHighFps: args?.forceHighFps === true || args?.force_high_fps === true,
                workspaceOnly: args?.workspaceOnly !== false,
                download: args?.download === true,
                force: args?.force === true,
                skipSpatialQa: args?.skipSpatialQa === true,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_export_html_motion_clip'),
            });
            return {
              name,
              args,
              result: exported.success
                ? `${name}: ${producerFailure ? `@hyperframes/producer failed (${producerFailure.message}); ` : ''}materialized and exported HyperFrames through the HTML Motion renderer.\n${JSON.stringify({ producerFailure, materialized: built, created: created.data, exported: exported.data || exported }).slice(0, 5000)}`
                : `${name}: ${producerFailure ? `@hyperframes/producer failed (${producerFailure.message}); ` : ''}materialized HyperFrames, but HTML Motion export failed: ${exported.error || 'export failed.'}`,
              error: !exported.success,
              data: { producerFailure, materialized: built, created, exported },
            };
          }
          let html = typeof args?.html === 'string' ? String(args.html) : '';
          let clip: any = null;
          if (!html.trim()) {
            const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
            const read = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
            clip = read.clip;
            html = String(clip?.meta?.html || '');
          }
          if (name === 'hyperframes_lint') {
            const lint = getHyperframesBridge().lintHyperframes(html);
            return {
              name,
              args,
              result: `${name}: ${((lint as any).valid === false || (lint as any).ok === false) ? 'blocked' : 'ok'}.\n${JSON.stringify(lint).slice(0, 5000)}`,
              error: false,
              data: lint,
            };
          }
          if (name === 'hyperframes_qa') {
            const report = await getHyperframesQa().runHyperframesQa(html, {
              width: Number(args?.width) || Number(clip?.width) || undefined,
              height: Number(args?.height) || Number(clip?.height) || undefined,
              durationMs: Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || undefined,
              samplePoints: Array.isArray(args?.samplePoints) ? args.samplePoints.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : undefined,
              timeoutMs: Number(args?.timeoutMs ?? args?.timeout_ms) || undefined,
            });
            return {
              name,
              args,
              result: `${name}: ${report.ok ? 'ok' : 'needs fixes'} (${report.samples.length} sample frames, ${report.networkErrors.length} network errors, ${report.consoleErrors.length} console errors).\n${JSON.stringify(report).slice(0, 5000)}`,
              error: false,
              data: report,
            };
          }
          const clipId = String(clip?.id || args?.clipId || args?.clip_id || args?.elementId || args?.element_id || 'hyperframes-clip').trim();
          const built = getHyperframesExportAdapter().buildHyperframesRenderClip(
            { id: clipId, type: 'hyperframes', meta: { html, compositionId: clip?.meta?.compositionId || args?.compositionId } },
            workspacePath,
            {
              startMs: Number(args?.startMs ?? args?.start_ms) || 0,
              endMs: Number(args?.endMs ?? args?.end_ms) || Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || 6000,
              trimStartMs: Number(args?.trimStartMs ?? args?.trim_start_ms) || 0,
            },
          );
          let activated: any = null;
          const shouldActivateMaterialized = args?.activate === true
            || args?.activateHtmlMotion === true
            || args?.activate_html_motion === true;
          const shouldReplaceCanvasWithMaterialized = args?.replaceCanvas === true
            || args?.replace_canvas === true
            || args?.updateScene === true
            || args?.update_scene === true;
          if (name === 'hyperframes_materialize' && shouldActivateMaterialized) {
            const materializedHtml = fs.readFileSync(built.materialized.absClipPath, 'utf-8');
            const safeBase = sanitizeCreativeStorageSegment(built.materialized.compositionId, 'hyperframes-clip');
            activated = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'create_html_motion_clip',
              payload: {
                title: `${built.materialized.compositionId} HyperFrames Materialized`,
                filename: `${safeBase}-hyperframes-materialized.html`,
                html: materializedHtml,
                width: Number(args?.width) || Number(clip?.width) || 1080,
                height: Number(args?.height) || Number(clip?.height) || 1920,
                durationMs: Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || 6000,
                frameRate: Number(args?.frameRate ?? args?.frame_rate) || 60,
                assets: [],
                updateScene: shouldReplaceCanvasWithMaterialized,
                activate: shouldReplaceCanvasWithMaterialized,
                render: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
            });
          }
          return {
            name,
            args,
            result: `${name}: materialized HyperFrames clip ${built.id} at ${built.materialized.clipPath}${activated ? (shouldReplaceCanvasWithMaterialized ? ' and replaced the current canvas with an HTML Motion clip' : ' and saved an HTML Motion copy without replacing the current canvas') : ''}.\n${JSON.stringify({ ...built, activated }).slice(0, 4000)}`,
            error: activated ? !activated.success : false,
            data: activated ? { ...built, activated } : built,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_apply_hyperframes_component': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const componentId = String(args?.componentId || args?.id || '').trim();
        if (!componentId) {
          return { name, args, result: `${name}: componentId is required.`, error: true };
        }
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let imported;
        try {
          imported = await getHyperframesCatalog().importHyperframesComponent(storage, componentId);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
        if (imported.importedAs === 'block') {
          try {
            const rendered = renderHtmlMotionBlock(imported.block.id, args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
            return {
              name,
              args,
              result: `${name}: imported and rendered HyperFrames block ${imported.item.name} (${imported.block.id}). Use creative_patch_html_motion_clip to insert the returned snippets into an active HTML motion clip.\n${JSON.stringify({ rendered, assets: imported.assets, warnings: imported.warnings }).slice(0, 5000)}`,
              error: false,
              data: { imported, rendered },
            };
          } catch (err: any) {
            return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true, data: imported };
          }
        }
        let rendered;
        try {
          rendered = applyHtmlMotionTemplate(imported.template.id, args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true, data: imported };
        }
        const payload = {
          html: rendered.html,
          title: String(args?.title || rendered.title || imported.item.name || ''),
          filename: String(args?.filename || ''),
          width: Number(args?.width) || rendered.width,
          height: Number(args?.height) || rendered.height,
          durationMs: Number(args?.durationMs) || rendered.durationMs,
          frameRate: Number(args?.frameRate) || rendered.frameRate,
          assets: [
            ...imported.assets,
            ...(Array.isArray(args?.assets) ? args.assets : []),
          ],
        };
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'create_html_motion_clip',
          payload,
          timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
        });
        const summary = result.success
          ? `${name}: applied HyperFrames component ${imported.item.name} (${imported.template.id}) as an HTML motion clip.`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify({ template: rendered.template, assets: imported.assets, warnings: imported.warnings, ...result.data }).slice(0, 5000)}`
            : summary,
          error: !result.success,
          data: { imported, template: rendered.template, ...result },
        };
      }

      case 'creative_apply_html_motion_template': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const templateId = String(args?.templateId || '').trim();
        if (!templateId) {
          return { name, args, result: `${name}: templateId is required.`, error: true };
        }
        let rendered;
        try {
          const reservedInputKeys = new Set([
            'templateId',
            'input',
            'inputs',
            'filename',
            'width',
            'height',
            'durationMs',
            'frameRate',
            'assets',
          ]);
          const topLevelInputs = Object.fromEntries(Object.entries(args || {})
            .filter(([key, value]) => !reservedInputKeys.has(key)
              && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
            .map(([key, value]) => [key, String(value)]));
          const explicitInputs = (args?.input && typeof args.input === 'object' && !Array.isArray(args.input)) ? args.input : {};
          const pluralInputs = (args?.inputs && typeof args.inputs === 'object' && !Array.isArray(args.inputs)) ? args.inputs : {};
          const inputs = {
            ...topLevelInputs,
            ...explicitInputs,
            ...pluralInputs,
          } as Record<string, string>;
          if (!inputs.durationSec && Number.isFinite(Number(args?.durationMs)) && Number(args.durationMs) > 0) {
            inputs.durationSec = String(Math.max(0.1, Number(args.durationMs) / 1000));
          }
          const storage = buildCreativeStorageForTool(workspacePath, sessionId);
          rendered = applyHtmlMotionTemplate(templateId, inputs, storage);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
        const payload = {
          html: rendered.html,
          title: String(args?.title || rendered.title || ''),
          filename: String(args?.filename || ''),
          width: Number(args?.width) || rendered.width,
          height: Number(args?.height) || rendered.height,
          durationMs: Number(args?.durationMs) || rendered.durationMs,
          frameRate: Number(args?.frameRate) || rendered.frameRate,
          assets: Array.isArray(args?.assets) ? args.assets : [],
        };
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'create_html_motion_clip',
          payload,
          timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
        });
        let textFit: any = null;
        try {
          textFit = reportHtmlTextFit(rendered.html, {
            stageWidth: payload.width || undefined,
            stageHeight: payload.height || undefined,
          });
        } catch { /* heuristic best-effort */ }
        const overflowSummary = textFit && !textFit.ok
          ? ` Pretext flagged ${textFit.overflowCount} text-fit warning(s) — run creative_text_fit_report for details.`
          : '';
        const summary = result.success
          ? `${name}: applied template ${rendered.template.name} (${templateId}) as HTML motion clip.${overflowSummary}`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify({ template: rendered.template, textFit, ...result.data }).slice(0, 4000)}`
            : summary,
          error: !result.success,
          data: { template: rendered.template, textFit, ...result },
        };
      }

        case 'creative_get_state':
        case 'creative_reset_scene':
        case 'creative_purge_scene':
        case 'creative_element_inventory':
        case 'creative_frame_trace':
        case 'creative_frame_diff':
        case 'creative_history_status':
        case 'creative_undo':
        case 'creative_redo':
        case 'creative_checkpoint':
        case 'creative_export_trace':
        case 'video_render_frame':
        case 'video_render_contact_sheet':
        case 'video_analyze_frame':
        case 'video_analyze_timeline':
        case 'video_check_keyframes':
        case 'video_check_caption_timing':
        case 'video_check_audio_sync':
        case 'video_extract_clip_frames':
        case 'image_get_element_at_point':
        case 'image_get_overlaps':
        case 'image_get_bounds_summary':
        case 'image_check_text_overflow':
        case 'image_check_contrast':
        case 'image_detect_empty_regions':
        case 'creative_apply_ops':
        case 'creative_select_element':
        case 'creative_set_canvas':
        case 'creative_add_element':
        case 'creative_add_asset':
        case 'creative_add_effect':
        case 'creative_set_blend_mode':
        case 'creative_add_mask':
        case 'creative_trim_clip':
        case 'creative_apply_brand_kit':
        case 'creative_search_icons':
        case 'creative_search_animations':
      case 'creative_update_element':
      case 'creative_delete_element':
      case 'creative_apply_animation':
      case 'creative_arrange':
      case 'creative_apply_style':
      case 'creative_fit_asset':
      case 'creative_apply_template':
      case 'creative_validate_layout':
      case 'creative_quality_report':
      case 'creative_create_html_motion_clip':
      case 'creative_read_html_motion_clip':
      case 'creative_patch_html_motion_clip':
      case 'creative_restore_html_motion_revision':
      case 'creative_render_html_motion_snapshot':
      case 'creative_export_html_motion_clip':
      case 'creative_apply_motion_template':
      case 'creative_timeline':
      case 'creative_render_snapshot':
      case 'creative_export':
      case 'creative_save_scene':
      case 'creative_composition_get':
      case 'creative_composition_add_track':
      case 'creative_composition_add_clip':
      case 'creative_composition_move_clip':
      case 'creative_composition_trim_clip':
      case 'creative_composition_split_at':
      case 'creative_composition_delete_clip':
      case 'creative_composition_set_transition':
      case 'creative_composition_select_clip':
      case 'creative_composition_lint':
      case 'creative_composition_save':
      case 'creative_composition_render': {
        const currentCreativeMode = getCreativeMode(sessionId);
        const creativeMode = currentCreativeMode && currentCreativeMode !== 'design'
          ? currentCreativeMode
          : (setCreativeMode(sessionId, 'video') || 'video');
        // A websocket connection alone does not mean the Creative editor is
        // mounted. Probe it before the expensive clip-create command so an
        // ordinary chat/browser client cannot cause a misleading 60s timeout.
        if (name === 'creative_create_html_motion_clip') {
          const readiness = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'get_state',
            payload: { readinessProbe: true },
            timeoutMs: 3000,
          });
          if (!readiness.success) {
            return {
              name,
              args,
              result: `${name}: Creative editor bridge is not ready. ${readiness.error || 'Open the Creative workspace and retry.'}`,
              error: true,
              data: {
                code: readiness.code || 'CREATIVE_EDITOR_UNAVAILABLE',
                readiness: readiness.readiness || 'unavailable',
                fallback: 'Use the HyperFrames CLI scaffold/lint/validate workflow until the editable Creative workspace is open.',
                probe: readiness,
              },
            };
          }
        }
        if (creativeMode === 'video') {
          if (VIDEO_MODE_REMOVED_SCENE_TOOL_NAMES.has(name)) {
            return videoModeHtmlMotionOnlyError(name, args);
          }
          if (name === 'creative_composition_add_clip' && isLegacySceneGraphCompositionPayload(args)) {
            return videoModeHtmlMotionOnlyError(name, args);
          }
        }
          const commandByTool: Record<string, string> = {
          creative_get_state: 'get_state',
          creative_reset_scene: 'reset_scene',
          creative_purge_scene: 'purge_scene',
          creative_element_inventory: 'element_inventory',
          creative_frame_trace: 'frame_trace',
          creative_frame_diff: 'frame_diff',
          creative_history_status: 'history_status',
          creative_undo: 'undo',
          creative_redo: 'redo',
          creative_checkpoint: 'checkpoint',
          creative_export_trace: 'export_trace',
          video_render_frame: 'render_snapshot',
          video_render_contact_sheet: 'render_snapshot',
          video_analyze_frame: 'render_snapshot',
          video_analyze_timeline: 'video_analyze_timeline',
          video_check_keyframes: 'video_check_keyframes',
          video_check_caption_timing: 'video_check_caption_timing',
          video_check_audio_sync: 'video_check_audio_sync',
          video_extract_clip_frames: 'render_snapshot',
          image_get_element_at_point: 'image_get_element_at_point',
          image_get_overlaps: 'image_get_overlaps',
          image_get_bounds_summary: 'image_get_bounds_summary',
          image_check_text_overflow: 'image_check_text_overflow',
          image_check_contrast: 'image_check_contrast',
          image_detect_empty_regions: 'image_detect_empty_regions',
          creative_apply_ops: 'apply_ops',
          creative_select_element: 'select_element',
          creative_set_canvas: 'set_canvas',
          creative_add_element: 'add_element',
          creative_add_asset: 'add_asset',
          creative_add_effect: 'apply_ops',
          creative_set_blend_mode: 'apply_ops',
          creative_add_mask: 'apply_ops',
          creative_trim_clip: 'apply_ops',
          creative_apply_brand_kit: 'apply_ops',
          creative_search_icons: 'search_icons',
          creative_search_animations: 'search_animations',
        creative_update_element: 'update_element',
          creative_delete_element: 'delete_element',
          creative_apply_animation: 'apply_animation',
          creative_arrange: 'arrange',
          creative_apply_style: 'apply_style',
          creative_fit_asset: 'fit_asset',
          creative_apply_template: 'apply_template',
          creative_validate_layout: 'validate_layout',
          creative_quality_report: 'quality_report',
          creative_create_html_motion_clip: 'create_html_motion_clip',
          creative_read_html_motion_clip: 'read_html_motion_clip',
          creative_patch_html_motion_clip: 'patch_html_motion_clip',
          creative_restore_html_motion_revision: 'restore_html_motion_revision',
          creative_render_html_motion_snapshot: 'render_html_motion_snapshot',
          creative_export_html_motion_clip: 'export_html_motion_clip',
          creative_apply_motion_template: 'apply_motion_template',
          creative_timeline: 'timeline',
          creative_render_snapshot: 'render_snapshot',
          creative_export: 'export',
          creative_save_scene: 'save_scene',
          creative_composition_get: 'composition_get',
          creative_composition_add_track: 'composition_add_track',
          creative_composition_add_clip: 'composition_add_clip',
          creative_composition_move_clip: 'composition_move_clip',
          creative_composition_trim_clip: 'composition_trim_clip',
          creative_composition_split_at: 'composition_split_at',
          creative_composition_delete_clip: 'composition_delete_clip',
          creative_composition_set_transition: 'composition_set_transition',
          creative_composition_select_clip: 'composition_select_clip',
          creative_composition_lint: 'composition_lint',
          creative_composition_save: 'composition_save',
          creative_composition_render: 'composition_render',
        };
        const renderAliasPayload = (() => {
          if (name === 'video_render_contact_sheet') {
            return {
              ...(args || {}),
              includeDataUrl: true,
              contactSheet: true,
              sampleTimesMs: Array.isArray(args?.sampleTimesMs) && args.sampleTimesMs.length
                ? args.sampleTimesMs
                : undefined,
            };
          }
          if (name === 'video_extract_clip_frames') {
            return {
              ...(args || {}),
              includeDataUrl: true,
              sampleEveryFrame: args?.sampleEveryFrame === true,
              frameStepMs: args?.sampleEveryFrame === true ? undefined : (args?.frameStepMs ?? 250),
            };
          }
          if (name === 'video_render_frame' || name === 'video_analyze_frame') {
            return { ...(args || {}), includeDataUrl: true };
          }
          if (name === 'creative_add_effect') {
            return {
              ops: [{
                op: 'add-effect',
                id: String(args?.id || '').trim(),
                effect: {
                  type: args?.type,
                  startMs: args?.startMs,
                  durationMs: args?.durationMs,
                  params: args?.params || {},
                  enabled: args?.enabled !== false,
                },
              }],
            };
          }
          if (name === 'creative_set_blend_mode') {
            return {
              ops: [{
                op: 'set-blend-mode',
                id: String(args?.id || '').trim(),
                blendMode: args?.blendMode,
              }],
            };
          }
          if (name === 'creative_add_mask') {
            return {
              ops: [{
                op: 'set-mask',
                id: String(args?.id || '').trim(),
                mask: args?.mask || {},
              }],
            };
          }
          if (name === 'creative_trim_clip') {
            return {
              ops: [{
                op: 'set-clip',
                id: String(args?.id || '').trim(),
                patch: {
                  startMs: args?.startMs,
                  endMs: args?.endMs,
                  durationMs: args?.durationMs,
                  trimStartMs: args?.trimStartMs,
                  trimEndMs: args?.trimEndMs,
                  speed: args?.speed,
                  loop: args?.loop,
                },
              }],
            };
          }
          if (name === 'creative_apply_brand_kit') {
            return {
              ops: [{
                op: args?.applyToScene === false ? 'set-brand-kit' : 'apply-brand-kit',
                brandKit: args?.brandKit || {},
              }],
            };
          }
          return null;
        })();
        if (creativeMode === 'video' && name === 'creative_export') {
          const quality = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'quality_report',
            payload: {},
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_quality_report'),
          });
          const qualityData: any = (quality as any)?.data || quality || {};
          const ship = qualityData?.ship;
          const ok = qualityData?.ok;
          if ((quality as any)?.success && (ship === false || ok === false)) {
            const findings = Array.isArray(qualityData?.findings)
              ? qualityData.findings.slice(0, 6).map((f: any) => `- ${String(f?.message || f?.title || f || '').trim()}`).join('\n')
              : '';
            return {
              name,
              args,
              result: [
                'Blocked export: creative_quality_report returned no-ship.',
                `score: ${qualityData?.score ?? 'unknown'}`,
                findings ? `findings:\n${findings}` : 'Run render/quality tools, fix the clip, then export again.',
              ].join('\n'),
              error: true,
              data: { quality: qualityData },
            };
          }
        }
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: creativeMode,
          command: commandByTool[name] || name,
          payload: renderAliasPayload || (name === 'creative_render_snapshot'
            ? { ...(args || {}), includeDataUrl: true }
            : (args || {})),
          timeoutMs: resolveCreativeEditorTimeoutMs(name, renderAliasPayload || args),
        });
        if (result.success && name === 'creative_get_state') {
          let renderResult = result;
          const durationMs = Number(result.data?.scene?.durationMs || result.sceneSummary?.durationMs || 0);
          const sampleTimesMs = creativeMode === 'video'
            ? [0, Math.round(Math.max(1000, durationMs || 8000) / 2), Math.max(0, Math.round((durationMs || 8000) - 250))]
            : undefined;
          renderResult = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'render_snapshot',
            payload: {
              includeDataUrl: true,
              ...(sampleTimesMs ? { sampleTimesMs } : { atMs: 0 }),
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_render_snapshot'),
          });
          if (renderResult?.success) {
            result.data = {
              ...(result.data || {}),
              creativeVisionFrames: renderResult.data?.frames || [],
              visualReviewSource: 'direct_frame_injection',
            };
            if (Array.isArray(renderResult?.snapshots)) result.snapshots = renderResult.snapshots;
            if (renderResult?.snapshot) result.snapshot = renderResult.snapshot;
          }
        }
        if (result.success && name === 'creative_quality_report' && creativeMode === 'video') {
          try {
            const clipRead = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
            });
            const clipAny: any = clipRead;
            const html = String(clipAny?.data?.clip?.html || clipAny?.clip?.html || clipAny?.data?.html || '');
            if (html) {
              const stage = result.data?.scene || result.sceneSummary || {};
              const textFit = reportHtmlTextFit(html, {
                stageWidth: Number(stage?.width) || undefined,
                stageHeight: Number(stage?.height) || undefined,
              });
              result.data = { ...(result.data || {}), textFit };
            }
          } catch { /* best-effort */ }
        }
        const summary = result.success
          ? `${name}: creative editor command succeeded.${result.data?.textFit && !result.data.textFit.ok ? ` Pretext flagged ${result.data.textFit.overflowCount} text-fit warning(s).` : ''}`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        if ((name === 'creative_export' || name === 'creative_export_html_motion_clip') && result.success) {
          await maybeSendCreativeExportToTelegram(sessionId, result.data?.data || result.data, deps.telegramChannel).catch(() => undefined);
          if (creativeMode === 'video') {
            result.data = {
              ...(result.data || {}),
              videoReviewSource: 'direct_frame_review_required',
              nextSelfReview:
                'Use creative_render_snapshot with sampleEveryFrame or sampleTimesMs to inject rendered video frames directly into the next model step.',
            };
          }
        }
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify(result.data).slice(0, 4000)}`
            : summary,
          error: !result.success,
          data: result,
        };
      }

      default:
        return undefined;
  }
}
