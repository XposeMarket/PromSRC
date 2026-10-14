import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../../comms/broadcaster';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import { autoAttachChatInputResources, getResourceStore, redactResourceText, type ResourceContextResult } from '../../../resources/resource-store';
import {
  executeShoppingSearchProducts,
  executeWebSearch,
  executeWebFetch,
} from '../../../../tools/web';
import { executeGenerateImage } from '../../../../tools/generate-image.js';
import { executeGenerateVideo } from '../../../../tools/generate-video.js';
import { executeWriteNote } from '../../../../tools/write-note';
import fs from 'fs';
import path from 'path';
import { rankSkillsForQuery } from '../../../agents-runtime/capabilities/skills-executor';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { getMemoryIndexRefreshWorkerStatus, searchMemoryIndexAsync, readMemoryRecord } from '../../../memory-index/index';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
  updateMainChatTimer,
} from '../../../timers/timer-store';
import {
  browserOpen,
  browserSnapshot,
  browserSnapshotDelta,
  browserClick,
  browserFill,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserDrag,
  browserClose,
  formatBrowserInteractionContextBlock,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
  browserGetFocusedItem,
  browserGetPageText,
  getLastBrowserScreenshot,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  getBrowserAdvisorPacket,
  listBrowserSessions,
  type BrowserAdvisorPacket,
  type BrowserObserveMode,
  resolveBrowserObserveMode,
} from '../../../browser-tools';
import {
  desktopFindWindow,
  desktopFocusWindowVerified,
  desktopWindowControl,
  desktopClick,
  desktopDrag,
  desktopScroll,
  desktopWait,
  desktopType,
  desktopTypeRaw,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  // Phase 4
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  // Phase 3
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopScreenshotWithHistory,
  desktopWindowScreenshot,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
  resolveDesktopActionPoint,
  getDesktopAdvisorPacketById,
  desktopGetActiveMonitorIndex,
  desktopGetMonitors,
  desktopGetMonitorsSummary,
  desktopFindInstalledApp,
  desktopListWindowsCanonical,
  desktopFocusWindowCanonical,
  desktopWindowClick,
  desktopWindowType,
  desktopWindowPressKey,
  desktopWindowScroll,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../../../desktop-tools';
import { executeDeliverySendScreenshot } from '../../../delivery-screenshot.js';
import { automationDashboardTool } from '../../../scheduling/schedule-admin-tools';
import { voiceOwnToolNames, VOICE_PROMETHEUS_TOOL_BLOCKLIST, executeVoiceCoreTool, executeVoicePrometheusTools } from './core-tools';
import { voiceToolResult, VOICE_SHOW_ARTIFACT_TOOLS, buildVoiceShowArtifact, summarizeVoiceSearchResult, isVoiceFetchEscalationUrl, readVoiceAgentMemoryFile, formatVoiceAgentMemoryAppend, cleanVoiceWakePhrase, summarizeVoiceSkill, buildVoiceSkillRuntimeGuidance, VOICE_SKILL_RESOURCE_MAX_CHARS, summarizeVoiceMemorySearch, captureVoiceBrowserObservation, broadcastVoiceBrowserStatus, voiceDesktopWindowSelector, captureVoiceDesktopObservation, captureVoiceDesktopWindowObservation, summarizeVoiceAutomationDashboard } from './tool-helpers';
import { compactVoiceText, invalidateVoiceAgentContextBlockCache, buildVoiceWorkerContextPacket, friendlyVoiceToolName } from './context';
import { broadcastVoiceScreenshotPreview, voiceDesktopSkipOcr, voiceDesktopCaptureAfter } from './decision';
import { isVoiceBrowserLaunchText, isDangerousVoiceLaunchText } from './fallback';
import { executeVoiceTaskControl, executeVoiceThreadOps, executeVoiceTaskDirectory, executeVoiceTaskWatch, standaloneVoiceAgents, executeVoiceAgentControl } from './task-tools';
import { _skillsManager, _telegramChannel, _cronScheduler } from './dependencies';


export async function executeVoiceAgentTool(sessionId: string, name: string, args: Record<string, any>): Promise<string> {
  const workspacePath = getConfig().getWorkspacePath();
  // Wrapper normalization (voice_ops/voice_browser/show_ui) produces internal
  // voice_* / show_* names that are not in the definition list; keep them here.
  if (name && !voiceOwnToolNames().has(name) && !/^(voice_|show_|skill_)/.test(name)) {
    if (VOICE_PROMETHEUS_TOOL_BLOCKLIST.has(name)) return voiceToolResult(false, `${name} is not available from voice.`);
    try {
      return await executeVoiceCoreTool(sessionId, name, args || {});
    } catch (err: any) {
      return voiceToolResult(false, `${name} failed: ${String(err?.message || err).slice(0, 300)}`);
    }
  }
  if (name === 'prometheus_tools') {
    try {
      return await executeVoicePrometheusTools(sessionId, args || {});
    } catch (err: any) {
      return voiceToolResult(false, `Prometheus tool failed: ${String(err?.message || err).slice(0, 300)}`);
    }
  }
  try {
    if (VOICE_SHOW_ARTIFACT_TOOLS.has(name)) {
      const built = await buildVoiceShowArtifact(name, args || {});
      const artifact = built.artifact as Record<string, any> | undefined;
      if (built.ok && artifact) {
        const linkItems = [artifact.items, artifact.products, artifact.links, artifact.sources]
          .filter(Array.isArray)
          .flat()
          .filter((item: any) => item && typeof item === 'object' && /^https?:\/\//i.test(String(item.url || item.link || item.href || '').trim()));
        if (linkItems.length) {
          try {
            getResourceStore(workspacePath).registerSourceItems(sessionId, linkItems, {
              actor: `voice_${name}`,
              origin: name === 'show_sources' ? 'tool_observation' : 'assistant_artifact',
            });
          } catch (error: any) {
            console.warn('[Resources] Voice card source registration skipped:', redactResourceText(error?.message || error));
          }
        }
      }
      return voiceToolResult(built.ok, built.summary, built.artifact ? { richArtifacts: [built.artifact] } : {});
    }
    if (name === 'voice_web_search') {
      const query = String(args.query || '').trim();
      if (!query) return voiceToolResult(false, 'Search query is required.');
      const mode = String(args.mode || 'auto').toLowerCase();
      // Keep the canonical worker default (configured preferred provider) for
      // auto/single. Multi-provider search remains an explicit voice choice,
      // so a current-news lookup does not silently fan out to every provider.
      const wantsMulti = mode === 'multi';
      const maxResults = Math.min(10, Math.max(1, Number(args.max_results ?? 5) || 5));
      const result = await executeWebSearch({
        query,
        max_results: maxResults,
        ...(wantsMulti
          ? { provider: 'multi' as const }
          : (mode === 'single' ? { multi_engine: false } : {})),
        ...(args.provider ? { provider: String(args.provider).toLowerCase() as any } : {}),
        ...(args.multi_engine === true ? { multi_engine: true } : {}),
        ...(args.fetch_top_k != null ? { fetch_top_k: Number(args.fetch_top_k) } : {}),
        ...(args.fetch_max_chars != null ? { fetch_max_chars: Number(args.fetch_max_chars) } : {}),
        ...(args.provider_timeout_ms != null ? { provider_timeout_ms: Number(args.provider_timeout_ms) } : {}),
      });
      if (result.success !== false) {
        const rows = Array.isArray(result.data?.results) ? result.data.results
          : Array.isArray(result.data?.items) ? result.data.items
            : [];
        try {
          getResourceStore(workspacePath).registerSourceItems(sessionId, rows, { actor: 'voice_web_search', origin: 'web_fetch' });
        } catch (error: any) {
          console.warn('[Resources] Voice search source registration skipped:', redactResourceText(error?.message || error));
        }
      }
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Search failed.') : 'Search complete.', summarizeVoiceSearchResult(result));
    }
    if (name === 'voice_web_fetch') {
      const url = String(args.url || '').trim();
      if (!url) return voiceToolResult(false, 'URL is required.');
      if (isVoiceFetchEscalationUrl(url)) {
        return voiceToolResult(false, 'This URL needs Worker handling because it is social/video/media-heavy or may need browser/media analysis.', { escalateToWorker: true, url });
      }
      const result = await executeWebFetch({ url, max_chars: Math.min(6000, Math.max(1200, Number(args.max_chars || 4000) || 4000)) });
      if (result.success !== false) {
        try {
          getResourceStore(workspacePath).registerSourceItems(sessionId, [{
            url: result.data?.final_url || result.data?.url || url,
            title: result.data?.title || url,
            text: result.stdout || '',
            mimeType: result.data?.mime_type || result.data?.content_type || 'text/html',
            fetched: true,
          }], { actor: 'voice_web_fetch', origin: 'web_fetch', fetched: true });
        } catch (error: any) {
          console.warn('[Resources] Voice fetch source registration skipped:', redactResourceText(error?.message || error));
        }
      }
      const text = compactVoiceText(result?.stdout || result?.error || '', 2400);
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Fetch failed.') : 'Fetch complete.', { text, url });
    }
    if (name === 'voice_generate_image') {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return voiceToolResult(false, 'Image prompt is required.');
      const result = await executeGenerateImage({
        prompt,
        reference_images: args.reference_images,
        aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
        count: args.count != null ? Number(args.count) : undefined,
        provider: args.provider != null ? String(args.provider) : undefined,
        model: args.model != null ? String(args.model) : undefined,
        background: args.background != null ? String(args.background) : undefined,
        output_format: args.output_format != null ? String(args.output_format) : undefined,
        quality: args.quality != null ? String(args.quality) : undefined,
        output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
        save_to_workspace: args.save_to_workspace,
      });
      if (!result.success) return voiceToolResult(false, result.error || 'Image generation failed.');
      const d = result.data as any;
      const count = Number(d?.image_count || 1);
      return voiceToolResult(true, `Generated ${count} image${count === 1 ? '' : 's'} with ${d?.provider}/${d?.model}. Saved to ${d?.rel_path || d?.path}.`, {
        provider: d?.provider,
        model: d?.model,
        prompt: d?.prompt,
        image_count: count,
        background: d?.background,
        output_format: d?.output_format,
        path: d?.path,
        rel_path: d?.rel_path,
        file_name: d?.file_name,
        images: d?.images,
      });
    }
    if (name === 'voice_generate_video') {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return voiceToolResult(false, 'Video prompt is required.');
      const result = await executeGenerateVideo({
        prompt,
        image: args.image != null ? String(args.image) : undefined,
        reference_images: args.reference_images,
        video: args.video != null ? String(args.video) : undefined,
        mode: args.mode != null ? String(args.mode) : undefined,
        aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
        duration: args.duration != null ? Number(args.duration) : undefined,
        resolution: args.resolution != null ? String(args.resolution) : undefined,
        provider: args.provider != null ? String(args.provider) : undefined,
        model: args.model != null ? String(args.model) : undefined,
        output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
        save_to_workspace: args.save_to_workspace,
      });
      if (!result.success) return voiceToolResult(false, result.error || 'Video generation failed.');
      const d = result.data as any;
      return voiceToolResult(true, `Generated video with ${d?.provider}/${d?.model}. Saved to ${d?.rel_path || d?.path}.`, {
        provider: d?.provider,
        model: d?.model,
        prompt: d?.prompt,
        mode: d?.mode,
        duration: d?.duration,
        resolution: d?.resolution,
        path: d?.path,
        rel_path: d?.rel_path,
        file_name: d?.file_name,
      });
    }
    if (name === 'voice_write_note') {
      const content = String(args.content || '').trim();
      if (/\bwake\s+(?:phrase|word)\b/i.test(content)) {
        return voiceToolResult(false, 'Wake phrase changes are runtime voice configuration. Use voice_set_wake_phrase instead of saving a note.', { runtimeAction: 'set_wake_phrase_required' });
      }
      if (!content) return voiceToolResult(false, 'Note content is required.');
      const result = await executeWriteNote({ content, tag: String(args.tag || 'voice').trim() || 'voice' });
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Note failed.') : 'Note saved.', { file: result.data?.file, tag: result.data?.tag });
    }
    if (name === 'voice_agent_memory') {
      const action = String(args.action || 'read').trim().toLowerCase();
      const maxChars = Math.min(12000, Math.max(800, Number(args.max_chars || args.maxChars || 5000) || 5000));
      const { filePath, content: currentContent } = readVoiceAgentMemoryFile(workspacePath);
      if (action === 'read') {
        const content = currentContent.length > maxChars ? `${currentContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : currentContent;
        return voiceToolResult(true, currentContent ? 'Voice agent memory loaded.' : 'Voice agent memory is empty.', {
          file: filePath,
          content,
          length: currentContent.length,
          truncated: currentContent.length > maxChars,
        });
      }
      if (action === 'append') {
        const entry = formatVoiceAgentMemoryAppend(args.content, args.category);
        if (!entry) return voiceToolResult(false, 'Content is required to append to voice agent memory.');
        const initial = currentContent.trim()
          ? currentContent.trimEnd()
          : '# Voice Agent Memory\n\nThese notes apply only to Prometheus in live voice and Realtime mode.\n';
        const nextContent = `${initial}\n${initial.endsWith('\n') ? '' : '\n'}${entry}\n`;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, nextContent, 'utf-8');
        invalidateVoiceAgentContextBlockCache(sessionId);
        return voiceToolResult(true, 'Voice agent memory updated live.', {
          file: filePath,
          action: 'append',
          appended: entry,
          content: nextContent.length > maxChars ? `${nextContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : nextContent,
          length: nextContent.length,
          truncated: nextContent.length > maxChars,
        });
      }
      if (action === 'replace') {
        const nextContent = String(args.content || '').trim();
        if (!nextContent) return voiceToolResult(false, 'Full replacement content is required.');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${nextContent}\n`, 'utf-8');
        invalidateVoiceAgentContextBlockCache(sessionId);
        return voiceToolResult(true, 'Voice agent memory replaced live.', {
          file: filePath,
          action: 'replace',
          content: nextContent.length > maxChars ? `${nextContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : nextContent,
          length: nextContent.length,
          truncated: nextContent.length > maxChars,
        });
      }
      return voiceToolResult(false, 'voice_agent_memory action must be read, append, or replace.');
    }
    if (name === 'voice_set_wake_phrase') {
      const phrase = cleanVoiceWakePhrase(args.phrase);
      if (!phrase) return voiceToolResult(false, 'Wake phrase is required.');
      return voiceToolResult(true, `Wake phrase set to "${phrase}".`, {
        runtimeAction: 'set_wake_phrase',
        wakePhrase: phrase,
      });
    }
    if (name === 'voice_enter_quiet_mode') {
      return voiceToolResult(true, 'Quiet mode will turn on after this acknowledgement, using the current wake phrase.', {
        runtimeAction: 'enter_quiet_mode',
        activateAfterReply: true,
        requiresWakePhrase: true,
      });
    }
    if (name === 'voice_set_quiet_until') {
      const phrase = cleanVoiceWakePhrase(args.phrase);
      if (!phrase) return voiceToolResult(false, 'Wake phrase is required before quiet mode can start.');
      return voiceToolResult(true, `Quiet mode will turn on after this acknowledgement. Wake phrase set to "${phrase}".`, {
        runtimeAction: 'set_quiet_until',
        wakePhrase: phrase,
        activateAfterReply: true,
      });
    }
    if (name === 'skill_list' || name === 'voice_skill_lookup') {
      _skillsManager.refreshSkillsIfChanged();
      const all = _skillsManager.getAll();
      const id = String(args.id || '').trim();
      const query = String(args.query || '').trim().toLowerCase();
      const explicitAll = !query || /\b(all|everything|every|list|show|available|installed|current(?:ly)?)\b/i.test(query);
      const limit = Math.min(80, Math.max(1, Number(args.limit || (explicitAll ? 40 : 20)) || (explicitAll ? 40 : 20)));
      const ranked = id
        ? all.filter((skill: any) => String(skill.id || '') === id).map((skill: any) => ({ skill, score: 0, confidence: 'strong' as const }))
        : explicitAll
          ? all.map((skill: any) => ({ skill, score: 0, confidence: 'strong' as const }))
          : rankSkillsForQuery(all, query);
      const candidates = ranked.map((item: any) => item.skill);
      const rankById = new Map(ranked.map((item: any) => [String(item.skill?.id || ''), item]));
      const skills: any[] = candidates.slice(0, limit).map((skill: any) => {
        const rank = rankById.get(String(skill.id || ''));
        return {
          ...summarizeVoiceSkill(skill),
          ...(query && !explicitAll ? { confidence: rank?.confidence, score: rank?.score } : {}),
        };
      });
      const truncated = candidates.length > skills.length;
      const summary = id
        ? (skills.length ? `Found skill "${skills[0].id}".` : `Skill "${id}" was not found.`)
        : candidates.length
          ? `Showing ${skills.length} of ${candidates.length} matching skill${candidates.length === 1 ? '' : 's'}; ${all.length} installed total.`
          : `No matching skills found; ${all.length} installed total.`;
      return voiceToolResult(true, summary, {
        skills,
        totalInstalled: all.length,
        matchedCount: candidates.length,
        returnedCount: skills.length,
        truncated,
        limit,
        note: truncated
          ? `This is a truncated result, not the complete skill list. Call skill_list again with limit up to 80 or a narrower query to see more.`
          : `This result is complete for the current query. Natural queries use the canonical structured-signal and metadata matcher.`,
      });
    }
    if (name === 'skill_read' || name === 'voice_skill_read') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      if (!skillId) return voiceToolResult(false, 'Skill id is required.');
      const skill = _skillsManager.get(skillId);
      if (!skill) return voiceToolResult(false, `Skill "${skillId}" not found.`, { missing: true });
      const eligibility = String(skill?.eligibility?.status || skill.status || '').toLowerCase();
      const verdict = String(skill?.safety?.verdict || '').toLowerCase();
      if (eligibility === 'blocked' || skill.status === 'blocked' || verdict === 'critical') {
        return voiceToolResult(false, `Skill "${skill.id}" is blocked and cannot be loaded in Realtime voice.`, {
          skill: summarizeVoiceSkill(skill),
          safety: skill.safety,
          eligibility: skill.eligibility,
        });
      }
      activateSkillForSession(sessionId, skill.id);
      let completeInstructions = String(skill.instructions || '');
      try { completeInstructions = fs.readFileSync(skill.filePath, 'utf-8'); } catch {}
      const resources = Array.isArray(skill.resources) ? skill.resources.map((resource: any) => ({
        path: resource.path,
        type: resource.type,
        description: compactVoiceText(resource.description || '', 180),
      })) : [];
      return voiceToolResult(true, `Loaded skill "${skill.name || skill.id}".`, {
        skill: summarizeVoiceSkill(skill),
        instructions: completeInstructions,
        runtimeGuidance: buildVoiceSkillRuntimeGuidance(skill),
        resources,
        completeEntrypoint: true,
        truncated: false,
      });
    }
    if (name === 'skill_resource_list') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      if (!skillId) return voiceToolResult(false, 'Skill id is required.');
      const skill = _skillsManager.get(skillId);
      if (!skill) return voiceToolResult(false, `Skill "${skillId}" not found.`);
      const resources = _skillsManager.listResources(skillId).slice(0, 40).map((resource: any) => ({
        path: resource.path,
        type: resource.type,
        description: compactVoiceText(resource.description || '', 180),
      }));
      return voiceToolResult(true, resources.length ? `Found ${resources.length} resource${resources.length === 1 ? '' : 's'} for "${skill.id}".` : `Skill "${skill.id}" has no resources.`, {
        id: skill.id,
        resources,
      });
    }
    if (name === 'skill_resource_read' || name === 'voice_skill_resource_read') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      const resourcePath = String(args.path || args.resource_path || '').trim();
      if (!skillId || !resourcePath) return voiceToolResult(false, 'Skill id and resource path are required.');
      const maxChars = Math.min(10000, Math.max(800, Number(args.max_chars || args.maxChars || VOICE_SKILL_RESOURCE_MAX_CHARS) || VOICE_SKILL_RESOURCE_MAX_CHARS));
      const result = _skillsManager.readResource(skillId, resourcePath, maxChars);
      if (!result.ok) return voiceToolResult(false, result.error || `Could not read ${skillId}/${resourcePath}.`);
      activateSkillForSession(sessionId, skillId);
      activateSkillResourceForSession(sessionId, skillId, result.path);
      return voiceToolResult(true, `Loaded skill resource ${skillId}/${result.path}.`, {
        id: skillId,
        path: result.path,
        content: result.content,
        truncated: result.truncated,
      });
    }
    if (name === 'voice_memory_search') {
      const readRecordId = String(args.read_record_id || args.record_id || '').trim();
      if (readRecordId) {
        const out = readMemoryRecord(workspacePath, readRecordId);
        return voiceToolResult(!!out.record, out.record ? 'Memory record read.' : `Memory record not found: ${readRecordId}`, { record: out.record ? compactVoiceText(JSON.stringify(out.record), 1800) : undefined });
      }
      const query = String(args.query || '').trim();
      if (!query) return voiceToolResult(false, 'Memory search query is required.');
      const modeRaw = String(args.mode || 'quick').trim().toLowerCase();
      const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline') ? modeRaw : 'quick';
      const out = await searchMemoryIndexAsync(workspacePath, {
        query,
        mode: mode as any,
        limit: Math.min(6, Math.max(2, Number(args.limit || 5) || 5)),
        rerank: true,
        queryRoute: 'voice_agent',
      });
      return voiceToolResult(true, 'Memory search complete.', summarizeVoiceMemorySearch(out));
    }
    if (name === 'voice_timer') {
      const action = String(args.action || '').trim().toLowerCase();
      if (action === 'list') {
        const timers = listMainChatTimers({ sessionId, includeDone: args.include_done === true });
        return voiceToolResult(true, timers.length ? `You have ${timers.length} timer${timers.length === 1 ? '' : 's'}.` : 'No active timers.', { timers: timers.slice(0, 8) });
      }
      if (action === 'cancel') {
        const timerId = String(args.timer_id || args.timerId || '').trim();
        if (!timerId) return voiceToolResult(false, 'Timer id is required to cancel.');
        const cancelled = cancelMainChatTimer(timerId);
        return voiceToolResult(!!cancelled, cancelled ? 'Timer cancelled.' : `Timer not found: ${timerId}`, { timer: cancelled || undefined });
      }
      if (action === 'update' || action === 'reschedule') {
        const timerId = String(args.timer_id || args.timerId || '').trim();
        if (!timerId) return voiceToolResult(false, 'Timer id is required to update.');
        const patch: Record<string, any> = {};
        if (args.instruction !== undefined) patch.instruction = String(args.instruction || '').trim();
        if (args.label !== undefined) patch.label = String(args.label || '').trim();
        const delay = Number(args.delay_seconds ?? args.delaySeconds);
        const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
        if (Number.isFinite(delay) && delay > 0) patch.dueAt = new Date(Date.now() + Math.max(5, Math.floor(delay)) * 1000).toISOString();
        else if (dueAtRaw) {
          const due = new Date(dueAtRaw);
          if (Number.isFinite(due.getTime())) patch.dueAt = due.toISOString();
        }
        if (patch.dueAt) patch.status = 'pending';
        const updated = Object.keys(patch).length ? updateMainChatTimer(timerId, patch) : null;
        return voiceToolResult(!!updated, updated ? `Timer updated for ${new Date(updated.dueAt).toLocaleString()}.` : 'Timer update failed.', { timer: updated || undefined });
      }
      if (action === 'create') {
        const instruction = String(args.instruction || args.prompt || '').trim();
        if (!instruction) return voiceToolResult(false, 'Timer instruction is required.');
        const delay = Number(args.delay_seconds ?? args.delaySeconds);
        const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
        let dueAt: Date | null = null;
        if (Number.isFinite(delay) && delay > 0) dueAt = new Date(Date.now() + Math.max(5, Math.floor(delay)) * 1000);
        else if (dueAtRaw) {
          const parsed = new Date(dueAtRaw);
          if (Number.isFinite(parsed.getTime())) dueAt = parsed;
        }
        if (!dueAt) return voiceToolResult(false, 'Timer needs delay_seconds or due_at.');
        const delivery = args.delivery && typeof args.delivery === 'object' ? args.delivery : {};
        const timer = createMainChatTimer({
          sessionId,
          instruction,
          dueAt,
          label: String(args.label || '').trim() || undefined,
          fromGoalTurn: true,
          origin: { channel: 'voice', voiceMode: true },
          delivery: {
            origin: delivery.origin !== false,
            telegram: delivery.telegram === true,
            voiceIfActive: delivery.voice_if_active !== false,
          },
        } as any);
        return voiceToolResult(true, `Timer created for ${new Date(timer.dueAt).toLocaleString()}.`, { timer });
      }
    }
    if (name === 'voice_browser_screenshot') {
      const shot = await browserVisionScreenshot(sessionId);
      if (!shot?.base64) return voiceToolResult(false, 'No active browser session to capture. Use the Worker if the browser needs to be opened first.');
      broadcastVoiceScreenshotPreview(sessionId, 'browser', name, shot);
      return voiceToolResult(true, `Captured browser screenshot${Number.isFinite(shot.width) && Number.isFinite(shot.height) ? ` (${shot.width}x${shot.height})` : ''}.`, {
        width: shot.width,
        height: shot.height,
        mimeType: shot.mimeType,
      });
    }
    if (name === 'voice_browser_open') {
      const rawUrl = String(args.url || '').trim();
      const query = String(args.query || '').trim();
      let url = rawUrl;
      if (!url && query) {
        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      } else if (url && /\s/.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(url)) {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
      if (!url) return voiceToolResult(false, 'URL or query is required.');
      const result = await browserOpen(sessionId, url, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      const openedUrl = (() => {
        try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
      })();
      return voiceToolResult(ok, ok ? `Opened ${query || rawUrl || openedUrl?.hostname || url}.` : result, {
        url,
        host: openedUrl?.hostname || '',
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_scroll') {
      const direction = String(args.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
      const amount = Math.min(4, Math.max(0.5, Number(args.amount || args.multiplier || 1) || 1));
      const result = await browserScroll(sessionId, direction, amount, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Scrolled ${direction}.` : result, {
        direction,
        amount,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_snapshot') {
      const result = await browserSnapshot(sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      if (ok) await broadcastVoiceBrowserStatus(sessionId, name, null).catch(() => {});
      return voiceToolResult(ok, ok ? 'Browser snapshot captured.' : result, {
        observation: compactVoiceText(result, 8000),
      });
    }
    if (name === 'voice_browser_get_page_text') {
      const result = await browserGetPageText(sessionId, {
        maxChars: Math.min(12000, Math.max(500, Number(args.max_chars || 6000) || 6000)),
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Read the current browser page.' : result, {
        observation: compactVoiceText(result, 12000),
      });
    }
    if (name === 'voice_browser_get_focused_item') {
      const result = await browserGetFocusedItem(sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Read the focused browser item.' : result, {
        observation: compactVoiceText(result, 5000),
      });
    }
    if (name === 'voice_browser_click') {
      const target = {
        ref: args.ref == null ? undefined : Number(args.ref),
        element: args.element == null && args.element_name == null ? undefined : String(args.element ?? args.element_name),
        selector: args.selector == null ? undefined : String(args.selector),
      };
      const result = await browserClick(sessionId, target, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser click complete.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_vision_click') {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return voiceToolResult(false, 'x and y are required.');
      const button = String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left';
      const result = await browserVisionClick(sessionId, x, y, button, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser vision click complete.' : result, {
        x,
        y,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_fill') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const target = {
        ref: args.ref == null ? undefined : Number(args.ref),
        element: args.element == null && args.element_name == null ? undefined : String(args.element ?? args.element_name),
        selector: args.selector == null ? undefined : String(args.selector),
      };
      const result = await browserFill(sessionId, target, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser field filled.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_type') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const result = await browserType(sessionId, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser typing complete.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_vision_type') {
      const x = Number(args.x);
      const y = Number(args.y);
      const text = String(args.text || '');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return voiceToolResult(false, 'x, y, and text are required.');
      const result = await browserVisionType(sessionId, x, y, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser vision typing complete.' : result, {
        x,
        y,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_press_key') {
      const key = String(args.key || '').trim();
      if (!key) return voiceToolResult(false, 'Key is required.');
      const result = await browserPressKey(sessionId, key, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Pressed ${key}.` : result, {
        key,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_wait') {
      const ms = Math.min(5000, Math.max(100, Number(args.ms || args.wait_ms || 750) || 750));
      const result = await browserWait(sessionId, ms, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Waited ${ms}ms.` : result, {
        ms,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_drag') {
      const result = await browserDrag(sessionId, {
        from_ref: args.from_ref == null ? undefined : Number(args.from_ref),
        to_ref: args.to_ref == null ? undefined : Number(args.to_ref),
        from_x: args.from_x == null ? undefined : Number(args.from_x),
        from_y: args.from_y == null ? undefined : Number(args.from_y),
        to_x: args.to_x == null ? undefined : Number(args.to_x),
        to_y: args.to_y == null ? undefined : Number(args.to_y),
        steps: args.steps == null ? undefined : Number(args.steps),
        observe: 'snapshot',
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser drag complete.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_close') {
      const result = await browserClose(sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Browser closed.' : result);
    }
    if (name === 'voice_desktop_screenshot') {
      const selector = voiceDesktopWindowSelector(args);
      const hasWindowTarget = !!(
        selector.window_token
        || selector.window_id
        || selector.app_id
        || String(selector.title || '').trim()
        || (Number.isFinite(Number(selector.window_handle)) && Number(selector.window_handle) > 0)
        || args?.active === true
      );
      const result = hasWindowTarget
        ? await desktopWindowScreenshot(sessionId, {
          window_token: selector.window_token,
          window_id: selector.window_id,
          window_handle: selector.window_handle,
          app_id: selector.app_id,
          title: selector.title,
          name: selector.title,
          handle: selector.window_handle,
          active: args?.active === true,
          focus_first: args?.focus_first == null ? undefined : args.focus_first !== false,
          padding: args?.padding == null ? undefined : Number(args.padding),
          mode: String(args?.mode || '').toLowerCase() === 'som' || args?.som === true ? 'som' : 'normal',
          som: args?.som === true || String(args?.mode || '').toLowerCase() === 'som',
          skipOcr: voiceDesktopSkipOcr(args),
        })
        : await desktopScreenshotWithHistory(sessionId, {
          ...(parseDesktopScreenshotToolArgs((args && typeof args === 'object') ? args as any : undefined) || {}),
          skipOcr: voiceDesktopSkipOcr(args),
        });
      const ok = !String(result || '').startsWith('ERROR');
      const packet = getDesktopAdvisorPacket(sessionId);
      if (ok && packet?.screenshotBase64) {
        broadcastVoiceScreenshotPreview(sessionId, 'desktop', name, {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
        });

      }
      const target = packet?.targetWindow;
      return voiceToolResult(ok, ok
        ? (target ? `Captured ${target.processName || 'window'} screenshot: ${target.title || 'untitled window'}.` : 'Captured desktop screenshot.')
        : result, ok && packet ? {
        screenshotId: packet.screenshotId,
        width: packet.width,
        height: packet.height,
        observation: compactVoiceText(result, 5000),
        targetWindow: target ? {
          title: target.title,
          processName: target.processName,
          handle: target.handle,
        } : undefined,
      } : {});
    }
    if (name === 'voice_desktop_click') {
      const clickTarget = {
        x: Number(args.x),
        y: Number(args.y),
        element: args.element == null ? undefined : Number(args.element),
        coordinate_space: args.coordinate_space as any,
        screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
        window_name: args.window_name == null && args.windowName == null ? undefined : String(args.window_name ?? args.windowName),
        window_handle: args.window_handle == null && args.windowHandle == null ? undefined : Number(args.window_handle ?? args.windowHandle),
        ...parseDesktopPointerMonitorArgs(args),
      };
      let resolved = await resolveDesktopActionPoint(sessionId, clickTarget, 'desktop_click');
      if (!resolved.ok && clickTarget.screenshot_id) {
        const msg = resolved.message;
        const isStale = msg.includes('is stale')
          || msg.includes('predates desktop action tracking')
          || /is \d+s old/.test(msg);
        if (isStale) {
          const oldPacket = getDesktopAdvisorPacketById(sessionId, clickTarget.screenshot_id);
            const freshCapture = oldPacket?.targetWindow
              ? await desktopWindowScreenshot(sessionId, {
                handle: oldPacket.targetWindow.handle,
                name: oldPacket.targetWindow.title,
                focus_first: true,
                skipOcr: voiceDesktopSkipOcr(args),
              }).catch(() => null)
            : await desktopScreenshotWithHistory(sessionId, { skipOcr: voiceDesktopSkipOcr(args) }).catch(() => null);
          const freshIdMatch = String(freshCapture || '').match(/Screenshot ID:\s*(ds_[^\s.]+)/);
          const freshId = freshIdMatch ? freshIdMatch[1] : null;
          if (freshId) {
            const retryResolved = await resolveDesktopActionPoint(
              sessionId,
              { ...clickTarget, screenshot_id: freshId },
              'desktop_click',
            );
            if (retryResolved.ok) resolved = retryResolved;
          }
        }
      }
      let result = !resolved.ok
        ? `ERROR: ${resolved.message}`
        : await desktopClick(
          resolved.point.x,
          resolved.point.y,
          String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          args.double_click === true || args.doubleClick === true,
          undefined,
          args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
            ? args.modifier
            : undefined,
          resolved.point.sourceNote,
          {
            mode: args.verify,
            coordinateSpace: resolved.point.coordinateSpace,
            allowRetryOnLikelyNoop: args.verify === 'strict',
          },
        );
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? 'Desktop click complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_drag') {
      const coords = [args.from_x, args.from_y, args.to_x, args.to_y].map(Number);
      if (!coords.every(Number.isFinite)) return voiceToolResult(false, 'from_x, from_y, to_x, and to_y are required.');
      const pointerArgs = parseDesktopPointerMonitorArgs(args);
      const result = await desktopDrag(coords[0], coords[1], coords[2], coords[3], Number(args.steps || 20), pointerArgs);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? 'Desktop drag complete.' : result, { observation: compactVoiceText(result, 3000), ...shotMeta });
    }
    if (name === 'voice_desktop_scroll') {
      const direction = ['up', 'down', 'left', 'right'].includes(String(args.direction || '').toLowerCase())
        ? String(args.direction).toLowerCase() as 'up' | 'down' | 'left' | 'right'
        : 'down';
      const result = await desktopScroll(direction, Number(args.amount || 3), args.x == null ? undefined : Number(args.x), args.y == null ? undefined : Number(args.y), direction === 'left' || direction === 'right', parseDesktopPointerMonitorArgs(args));
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? `Desktop scrolled ${direction}.` : result, { observation: compactVoiceText(result, 3000), ...shotMeta });
    }
    if (name === 'voice_desktop_type' || name === 'voice_desktop_type_raw') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const result = name === 'voice_desktop_type_raw' ? await desktopTypeRaw(text) : await desktopType(text);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? 'Desktop typing complete.' : result, { observation: compactVoiceText(result, 3000), ...shotMeta });
    }
    if (name === 'voice_desktop_press_key') {
      const key = String(args.key || '').trim();
      if (!key) return voiceToolResult(false, 'Key is required.');
      const result = await desktopPressKey(key);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? `Pressed ${key}.` : result, { observation: compactVoiceText(result, 3000), ...shotMeta });
    }
    if (name === 'voice_desktop_wait') {
      const ms = Math.min(5000, Math.max(50, Number(args.ms || args.wait_ms || 500) || 500));
      const result = await desktopWait(ms);
      return voiceToolResult(true, result || `Waited ${ms}ms.`, { ms });
    }
    if (name === 'voice_desktop_get_clipboard') {
      const result = await desktopGetClipboard({ max_chars: Math.min(5000, Math.max(100, Number(args.max_chars || 1200) || 1200)) });
      return voiceToolResult(!/^ERROR:/i.test(String(result || '')), 'Clipboard read.', { clipboard: compactVoiceText(result, 5000) });
    }
    if (name === 'voice_desktop_set_clipboard') {
      const result = await desktopSetClipboard(String(args.text || ''));
      return voiceToolResult(!/^ERROR:/i.test(String(result || '')), result);
    }
    if (name === 'voice_desktop_get_monitors') {
      const result = await desktopGetMonitorsSummary();
      return voiceToolResult(!/^ERROR:/i.test(String(result || '')), 'Desktop monitors listed.', { monitors: compactVoiceText(result, 5000) });
    }
    if (name === 'voice_desktop_window_control') {
      const actionRaw = String(args.action || '').toLowerCase();
      const action = actionRaw === 'minimize' || actionRaw === 'maximize' || actionRaw === 'restore' || actionRaw === 'close'
        ? actionRaw
        : 'restore';
      const result = await desktopWindowControl(action, {
        window_token: args.window_token == null && args.windowToken == null ? undefined : String(args.window_token ?? args.windowToken),
        window_id: args.window_id == null ? undefined : String(args.window_id),
        window_handle: args.window_handle == null && args.windowHandle == null ? undefined : Number(args.window_handle ?? args.windowHandle),
        app_id: args.app_id == null && args.appId == null ? undefined : String(args.app_id ?? args.appId),
        title: args.title == null ? undefined : String(args.title),
        name: args.name == null && args.title == null ? undefined : String(args.name ?? args.title),
        handle: args.handle == null && args.window_handle == null && args.windowHandle == null ? undefined : Number(args.handle ?? args.window_handle ?? args.windowHandle),
        active: args.active === true,
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shouldCapture = ok
        && voiceDesktopCaptureAfter(args)
        && (action === 'maximize' || action === 'restore');
      const shotMeta = shouldCapture
        ? await captureVoiceDesktopWindowObservation(sessionId, name, {
          ...args,
          active: !args.name && !args.title && !args.handle && !args.window_handle && !args.windowHandle,
        }, true)
        : {};
      return voiceToolResult(ok, ok ? `Window ${action} complete.` : result, {
        action,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_focus_window') {
      const selector = voiceDesktopWindowSelector(args);
      const windowName = String(selector.title || '').trim();
      const hasCanonicalSelector = !!(selector.window_token || selector.window_id || selector.window_handle || selector.app_id);
      if (!windowName && !hasCanonicalSelector) return voiceToolResult(false, 'Window name or canonical window selector is required.');
      const includeScreenshot = args.include_screenshot !== false;
      if (hasCanonicalSelector) {
        const result = await desktopFocusWindowCanonical(
          sessionId,
          selector,
          includeScreenshot,
          undefined,
          { skipOcr: voiceDesktopSkipOcr(args) },
        );
        const ok = !/^ERROR:/i.test(String(result || ''));
        const packet = getDesktopAdvisorPacket(sessionId);
        if (ok && includeScreenshot && packet?.screenshotBase64) {
          broadcastVoiceScreenshotPreview(sessionId, 'desktop', name, {
            base64: packet.screenshotBase64,
            mimeType: packet.screenshotMime || 'image/png',
            width: packet.width,
            height: packet.height,
          });
        }
        return voiceToolResult(ok, ok ? compactVoiceText(result, 3000) : result, {
          ...selector,
          ...(packet ? { screenshotId: packet.screenshotId, width: packet.width, height: packet.height } : {}),
        });
      }
      const verification = await desktopFocusWindowVerified(sessionId, windowName, {
        includeScreenshot,
        skipOcr: voiceDesktopSkipOcr(args),
      });
      if (!verification.ok) return voiceToolResult(false, verification.message, { name: windowName });
      const packet = getDesktopAdvisorPacket(sessionId);
      if (includeScreenshot && packet?.screenshotBase64) {
        broadcastVoiceScreenshotPreview(sessionId, 'desktop', name, {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
        });
      }
      return voiceToolResult(true, verification.verification.summary, {
        name: windowName,
        verification: verification.verification,
      });
    }
    if (name === 'voice_desktop_launch_app') {
      const app = String(args.app || '').trim();
      const appId = String(args.app_id || args.appId || '').trim();
      if (!app && !appId) return voiceToolResult(false, 'App name or app_id is required.');
      const launchText = `${app} ${appId}`.trim();
      if (isVoiceBrowserLaunchText(launchText)) {
        return voiceToolResult(false, 'That is a browser/web request, not a desktop app launch. Use voice_browser_open for browser, Chrome, Edge, URLs, domains, pages, tabs, or search.', {
          useTool: 'voice_browser_open',
          suggestedArgs: /\b(?:browser|chrome|chromium|edge)\b/i.test(launchText) && !/\b(?:https?:\/\/|www\.|\.[a-z]{2,}\b|search|google|bing|duckduckgo)\b/i.test(launchText)
            ? { url: 'https://www.google.com', include_screenshot: true }
            : { query: launchText, include_screenshot: true },
        });
      }
      if (isDangerousVoiceLaunchText(launchText)) {
        return voiceToolResult(false, 'Refusing to launch installer/build-tool shortcuts from the voice desktop app launcher. Create a Prometheus thread if an install or tooling setup is actually required.', {
          useTool: 'voice_thread_ops',
        });
      }
      const result = await desktopLaunchApp(app, '', Math.min(20000, Math.max(1000, Number(args.wait_ms || args.waitMs || 6000) || 6000)), appId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? result : result, {
        app,
        appId,
      });
    }
    if (name === 'voice_desktop_find_app') {
      const query = String(args.query || args.app || '').trim();
      if (!query) return voiceToolResult(false, 'App query is required.');
      const result = await desktopFindInstalledApp(query, Math.min(20, Math.max(1, Number(args.limit || 8) || 8)), args.refresh === true);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Desktop app lookup complete.' : result, {
        query,
        candidates: compactVoiceText(result, 5000),
      });
    }
    if (name === 'voice_desktop_list_windows') {
      const result = await desktopListWindowsCanonical({
        app_id: args.app_id == null && args.appId == null ? undefined : String(args.app_id ?? args.appId),
        process_name: args.process_name == null && args.processName == null ? undefined : String(args.process_name ?? args.processName),
        title: args.title == null ? undefined : String(args.title),
        filter: args.filter == null ? undefined : String(args.filter),
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Desktop windows listed.' : result, {
        windows: compactVoiceText(result, 7000),
      });
    }
    if (name === 'voice_desktop_window_click') {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return voiceToolResult(false, 'x and y are required.');
      const selector = voiceDesktopWindowSelector(args);
      const result = await desktopWindowClick(
        selector,
        {
          x,
          y,
          coordinate_space: args.coordinate_space || args.coordinateSpace || 'window',
          screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
        } as any,
        {
          button: String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          double_click: args.double_click === true || args.doubleClick === true,
          modifier: args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
            ? args.modifier
            : undefined,
          verify: args.verify,
        } as any,
        sessionId,
      );
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? 'Desktop window click complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_type') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const result = await desktopWindowType(voiceDesktopWindowSelector(args), text, args.raw === true);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? 'Desktop window typing complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_press_key') {
      const key = String(args.key || '').trim();
      if (!key) return voiceToolResult(false, 'Key is required.');
      const result = await desktopWindowPressKey(voiceDesktopWindowSelector(args), key);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? `Pressed ${key} in desktop window.` : result, {
        key,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_scroll') {
      const directionRaw = String(args.direction || 'down').toLowerCase();
      const direction = (directionRaw === 'up' || directionRaw === 'left' || directionRaw === 'right') ? directionRaw : 'down';
      const result = await desktopWindowScroll(voiceDesktopWindowSelector(args), {
        direction,
        amount: Math.min(8, Math.max(0.25, Number(args.amount || 1) || 1)),
        x: args.x == null ? undefined : Number(args.x),
        y: args.y == null ? undefined : Number(args.y),
        coordinate_space: args.coordinate_space || args.coordinateSpace || 'window',
        screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
      } as any, sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, voiceDesktopCaptureAfter(args)) : {};
      return voiceToolResult(ok, ok ? `Scrolled ${direction} in desktop window.` : result, {
        direction,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_send_screenshot') {
      const delivered = await executeDeliverySendScreenshot({
        ...args,
        target: args?.target || 'origin',
      }, workspacePath, { telegramChannel: _telegramChannel, broadcastWS }, sessionId);
      return voiceToolResult(!delivered.error, delivered.result);
    }
    if (name === 'voice_automation_dashboard') {
      if (!_cronScheduler) return voiceToolResult(false, 'Automation scheduler is not ready yet.');
      const limit = Math.min(50, Math.max(1, Number(args.limit || 12) || 12));
      const depth = String(args.depth || 'summary').toLowerCase() === 'full' ? 'full' : 'summary';
      const raw = automationDashboardTool(_cronScheduler, {
        ...args,
        limit,
        depth,
      });
      const ok = raw.success !== false;
      const snapshot = raw.data || {};
      const summary = summarizeVoiceAutomationDashboard(snapshot);
      const jobsByHealth = summary.jobsByHealth && typeof summary.jobsByHealth === 'object'
        ? Object.entries(summary.jobsByHealth).map(([state, count]) => `${state}: ${count}`).join(', ')
        : '';
      const tasksByStatus = summary.tasksByStatus && typeof summary.tasksByStatus === 'object'
        ? Object.entries(summary.tasksByStatus).map(([status, count]) => `${status}: ${count}`).join(', ')
        : '';
      const spokenSummary = ok
        ? [
            `Automation snapshot loaded: ${summary.counts?.jobs ?? 0} jobs, ${summary.counts?.watches ?? 0} watches, ${summary.pendingEventCount ?? 0} pending events.`,
            jobsByHealth ? `Job health: ${jobsByHealth}.` : '',
            tasksByStatus ? `Tasks: ${tasksByStatus}.` : '',
            summary.attentionJobs?.length ? `${summary.attentionJobs.length} scheduled job(s) need attention.` : '',
            summary.activeTasks?.length ? `${summary.activeTasks.length} active task(s) are in flight.` : '',
          ].filter(Boolean).join(' ')
        : (raw.error || raw.message || 'Automation dashboard failed.');
      return voiceToolResult(ok, spokenSummary, {
        dashboardSummary: summary,
        dashboard: snapshot,
        message: raw.message || '',
        error: raw.error || '',
      });
    }
    if (name === 'voice_task_control') {
      return await executeVoiceTaskControl(sessionId, args || {});
    }
    if (name === 'voice_thread_ops') {
      return await executeVoiceThreadOps(sessionId, args || {});
    }
    if (name === 'voice_task_directory') {
      return executeVoiceTaskDirectory(args || {});
    }
    if (name === 'voice_task_watch') {
      return executeVoiceTaskWatch(sessionId, args || {});
    }
    if (name === 'voice_agent_directory') {
      const agents = standaloneVoiceAgents();
      return voiceToolResult(true, agents.length ? `Found ${agents.length} configured subagent${agents.length === 1 ? '' : 's'}.` : 'No standalone subagents are configured.', { agents });
    }
    if (name === 'voice_agent_control') {
      return await executeVoiceAgentControl(sessionId, args || {});
    }
    if (name === 'voice_worker_status') {
      const providedPacket = args?.contextPacket && typeof args.contextPacket === 'object' ? args.contextPacket : null;
      const providedSessionId = String(providedPacket?.sessionId || '').trim();
      const providedAgeMs = Date.now() - Number(providedPacket?.createdAt || 0);
      const providedIsFreshActive = !!(
        providedPacket?.active === true
        && providedSessionId === sessionId
        && Number.isFinite(providedAgeMs)
        && providedAgeMs >= 0
        && providedAgeMs <= 45_000
      );
      const contextPacket = providedIsFreshActive
        ? providedPacket
        : buildVoiceWorkerContextPacket(sessionId, { source: 'voice_worker_status_tool', voiceTarget: args?.voiceTarget });
      const recentEvents = args?.include_recent_events === false ? [] : contextPacket.recentEvents;
      const processEntries = args?.include_recent_events === false ? [] : contextPacket.processEntries;
      const active = contextPacket.active === true;
      const summary = contextPacket.summary
        ? String(contextPacket.summary)
        : active
          ? 'A Prometheus worker is active, but it has not published a detailed status yet.'
          : 'No Prometheus worker is currently active for this chat.';
      return voiceToolResult(true, active ? 'Worker status loaded.' : 'No active worker.', {
        active,
        summary: compactVoiceText(summary, 1600),
        currentGoal: contextPacket.currentGoal || '',
        currentPhase: contextPacket.currentPhase || '',
        activeToolName: contextPacket.activeToolName || '',
        activeToolLabel: contextPacket.activeToolLabel || '',
        pendingSteerCount: contextPacket.pendingSteerCount || 0,
        target: contextPacket.target || null,
        thread: contextPacket.thread || null,
        activeRun: contextPacket.activeRun || null,
        trigger: contextPacket.trigger || null,
        doneAlready: contextPacket.doneAlready || [],
        currentlyDoing: contextPacket.currentlyDoing || '',
        observations: contextPacket.observations || null,
        recentEvents,
        processEntries,
        contextPacketId: contextPacket.id,
        createdAt: contextPacket.createdAt,
      });
    }


  } catch (err: any) {
    return voiceToolResult(false, `${friendlyVoiceToolName(name)} failed: ${String(err?.message || err)}`);
  }
  return voiceToolResult(false, `Unknown voice tool: ${name}`);
}
