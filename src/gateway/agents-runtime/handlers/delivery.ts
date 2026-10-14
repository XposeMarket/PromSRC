import fs from 'fs';
import path from 'path';
import { buildObsoleteBrandBlockMessage, containsObsoleteProductBrand } from './../../scheduled-output-guard';
import { linkTelegramSession } from './../../comms/broadcaster';
import { deliverToTargets, readAttachmentBuffer } from './../../delivery-router';
import { executeDeliverySendScreenshot } from './../../delivery-screenshot.js';
import { collectDeliveryFilePaths, buildPresentedFileArtifact } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleDeliveryToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleDeliveryTool(ctx: handleDeliveryToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


      case 'delivery_send': {
        const deliveryAction = String(args.action || 'send').trim().toLowerCase();
        if (deliveryAction === 'screenshot') {
          const delivered = await executeDeliverySendScreenshot(args, workspacePath, deps, sessionId);
          return { name, args, result: delivered.result, error: delivered.error };
        }
        const msgText = String(args.text || args.message || '').trim();
        if (msgText && containsObsoleteProductBrand(msgText)) {
          return { name, args, result: `ERROR: ${buildObsoleteBrandBlockMessage('delivery payload')}`, error: true };
        }
        try {
          if (deliveryAction === 'present_file') {
            const requestedPaths = collectDeliveryFilePaths(args);
            if (!requestedPaths.length) return { name, args, result: 'ERROR: path, paths, files, attachmentPath, or attachmentPaths is required.', error: true };
            const resolvedFiles = requestedPaths.map((filePath) => {
              const absPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspacePath, filePath);
              if (!fs.existsSync(absPath)) throw new Error(`File not found: ${filePath}`);
              const relPath = path.isAbsolute(filePath) ? path.relative(workspacePath, absPath).replace(/\\/g, '/') : filePath.replace(/\\/g, '/');
              return { absPath, relPath, fileName: path.basename(absPath) };
            });
            const artifacts = resolvedFiles.map((file) => buildPresentedFileArtifact(
              file.absPath,
              file.relPath,
              resolvedFiles.length === 1 ? String(args.title || args.caption || '').trim() : undefined,
            ));
            const delivered: string[] = [];
            const errors: string[] = [];
            const batchId = resolvedFiles.length > 1 ? `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` : undefined;
            for (const [batchIndex, file] of resolvedFiles.entries()) {
              const delivery = await deliverToTargets({
                sessionId,
                target: args.target || 'origin',
                text: msgText || (resolvedFiles.length > 1 ? `${resolvedFiles.length} files ready` : `File ready: ${file.fileName}`),
                caption: String(args.caption || msgText || file.fileName || '').trim(),
                attachmentPath: file.absPath,
                fileName: file.fileName,
                source: 'delivery_send:present_file',
                batchId,
                batchIndex,
                batchCount: resolvedFiles.length,
              }, { telegramChannel: deps.telegramChannel, broadcastWS: deps.broadcastWS });
              delivered.push(...delivery.delivered);
              errors.push(...delivery.errors);
            }
            const fileList = resolvedFiles.map((file) => file.relPath).join(', ');
            const suffix = errors.length ? ` Errors: ${errors.join('; ')}` : '';
            return {
              name,
              args,
              result: `Presented ${resolvedFiles.length} file${resolvedFiles.length === 1 ? '' : 's'}: ${fileList}.${delivered.length ? ` Delivered via ${Array.from(new Set(delivered)).join(', ')}.` : ''}${suffix}`,
              error: false,
              data: { files: resolvedFiles.map((file) => ({ path: file.relPath, absPath: file.absPath, fileName: file.fileName })) },
              artifacts,
              extra: { presented_files: artifacts },
            };
          }
          if (deliveryAction !== 'send') {
            return { name, args, result: `ERROR: Unsupported delivery_send action "${deliveryAction}".`, error: true };
          }
          let imageBuffer: Buffer | undefined;
          let attachmentPath: string | undefined;
          let mimeType = args.mimeType ? String(args.mimeType) : undefined;
          let fileName: string | undefined;
          if (args.imageBase64) {
            imageBuffer = Buffer.from(String(args.imageBase64), 'base64');
            mimeType = mimeType || 'image/png';
          }
          const attachmentPaths = collectDeliveryFilePaths(args);
          if (attachmentPaths.length > 1) {
            const delivered: string[] = [];
            const errors: string[] = [];
            const artifacts: any[] = [];
            const batchId = `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            for (const [batchIndex, rawPath] of attachmentPaths.entries()) {
              const file = readAttachmentBuffer(rawPath, workspacePath);
              const relPath = path.relative(workspacePath, file.absPath).replace(/\\/g, '/');
              artifacts.push(buildPresentedFileArtifact(file.absPath, relPath));
              const delivery = await deliverToTargets({
                sessionId,
                target: args.target || 'origin',
                text: msgText || `${attachmentPaths.length} files ready`,
                caption: String(args.caption || msgText || file.fileName || '').trim(),
                attachmentPath: file.absPath,
                imageBuffer: file.mimeType.startsWith('image/') ? file.buffer : undefined,
                mimeType: file.mimeType,
                fileName: file.fileName,
                source: 'delivery_send',
                batchId,
                batchIndex,
                batchCount: attachmentPaths.length,
              }, { telegramChannel: deps.telegramChannel, broadcastWS: deps.broadcastWS });
              delivered.push(...delivery.delivered);
              errors.push(...delivery.errors);
            }
            const suffix = errors.length ? ` Errors: ${errors.join('; ')}` : '';
            return {
              name,
              args,
              result: delivered.length ? `Delivered ${attachmentPaths.length} files via ${Array.from(new Set(delivered)).join(', ')}.${suffix}` : `ERROR: Delivery failed.${suffix}`,
              error: delivered.length === 0,
              artifacts,
              extra: { presented_files: artifacts },
            };
          }
          if (attachmentPaths.length === 1) {
            const file = readAttachmentBuffer(attachmentPaths[0], workspacePath);
            attachmentPath = file.absPath;
            fileName = file.fileName;
            mimeType = mimeType || file.mimeType;
            if (file.mimeType.startsWith('image/') && !imageBuffer) imageBuffer = file.buffer;
          }
          if (!msgText && !imageBuffer && !attachmentPath) return { name, args, result: 'ERROR: text, imageBase64, or attachmentPath is required.', error: true };
          const delivered = await deliverToTargets({
            sessionId,
            target: args.target || 'origin',
            text: msgText,
            caption: String(args.caption || msgText || '').trim(),
            attachmentPath,
            imageBuffer,
            mimeType,
            fileName,
            source: 'delivery_send',
          }, { telegramChannel: deps.telegramChannel, broadcastWS: deps.broadcastWS });
          const suffix = delivered.errors.length ? ` Errors: ${delivered.errors.join('; ')}` : '';
          return {
            name,
            args,
            result: delivered.delivered.length ? `Delivered via ${delivered.delivered.join(', ')}.${suffix}` : `ERROR: Delivery failed.${suffix}`,
            error: delivered.delivered.length === 0,
          };
        } catch (err: any) {
          return { name, args, result: `ERROR: Delivery failed: ${err?.message || err}`, error: true };
        }
      }

      case 'delivery_send_screenshot': {
        const delivered = await executeDeliverySendScreenshot(args, workspacePath, deps, sessionId);
        return { name, args, result: delivered.result, error: delivered.error };
      }

	      case 'send_telegram': {
        if (!deps.telegramChannel) {
          return { name, args, result: 'ERROR: Telegram channel not configured.', error: true };
        }
        // ── Bridge: link this session to the Telegram user so replies route back here ──
        try {
          const allowedIds: number[] = (deps.telegramChannel as any).getAllowedUserIds?.() || [];
          for (const uid of allowedIds) {
            linkTelegramSession(uid, sessionId);
          }
        } catch {}
        const msgText = String(args.text || args.message || '').trim();
        const sendPhoto = args.screenshot === true;
        if (msgText && containsObsoleteProductBrand(msgText)) {
          return { name, args, result: `ERROR: ${buildObsoleteBrandBlockMessage('Telegram payload')}`, error: true };
        }
        try {
          if (sendPhoto) {
            // Grab latest desktop screenshot from session
            const { getDesktopAdvisorPacket } = require('./../../desktop-tools');
            const packet = getDesktopAdvisorPacket(sessionId);
            if (!packet?.screenshotBase64) {
              return { name, args, result: 'ERROR: No screenshot available. Call desktop_screenshot first, then send_telegram with screenshot:true.', error: true };
            }
            const caption = msgText || 'Screenshot from Prometheus';
            // Take a fresh screenshot before sending so user sees current state
            try { await (require('./../../desktop-tools') as any).desktopScreenshot(sessionId); } catch {}
            const freshPacket = (require('./../../desktop-tools') as any).getDesktopAdvisorPacket(sessionId) || packet;
            await deps.telegramChannel.sendPhotoToAllowed(
              Buffer.from(freshPacket.screenshotBase64, 'base64'),
              caption,
            );
            return { name, args, result: `Screenshot sent to Telegram with caption: "${caption.slice(0, 80)}".`, error: false };
          } else {
            if (!msgText) return { name, args, result: 'ERROR: text or message is required.', error: true };
            await deps.telegramChannel.sendToAllowed(msgText);
            return { name, args, result: `Message sent to Telegram: "${msgText.slice(0, 80)}${msgText.length > 80 ? '...' : ''}".`, error: false };
          }
        } catch (err: any) {
          return { name, args, result: `ERROR: Telegram send failed: ${err?.message || err}`, error: true };
        }
      }

      case 'present_file': {
        const filePath = String(args?.path || args?.filename || '').trim();
        if (!filePath) return { name, args, result: 'ERROR: path is required', error: true };
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        if (!fs.existsSync(absPath)) return { name, args, result: `File not found: ${filePath}`, error: true };
        const relPath = (path.isAbsolute(filePath) ? path.relative(workspacePath, absPath) : filePath).replace(/\\/g, '/');
        const artifact = buildPresentedFileArtifact(absPath, relPath, String(args?.title || '').trim());
        return {
          name,
          args,
          result: `File presented: ${relPath}`,
          error: false,
          data: { path: relPath, absPath },
          artifacts: [artifact],
          extra: { presented_file: artifact, presented_files: [artifact] },
        };
      }
 }
 throw new Error(`Unsupported delivery tool: ${name}`);
}
