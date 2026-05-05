/**
 * canvas.router.ts — B2 Refactor
 *
 * Canvas File API + Preview + Utility routes.
 * Extracted verbatim from server-v2.ts (was L5279-L5558).
 *
 * GET  /api/canvas/file           — read a workspace file for the canvas
 * POST /api/canvas/file           — write canvas edits back to workspace
 * POST /api/canvas/upload         — copy an uploaded file into workspace/uploads/
 * GET  /api/canvas/files          — list workspace files for the file browser
 * POST /api/canvas/open           — register a file as open in canvas
 * POST /api/canvas/close          — remove a file from canvas tracking
 * GET  /preview                   — serve a workspace file as renderable HTML
 * GET  /api/preview/screenshot    — take a screenshot of the preview route
 * GET  /api/open-path             — open a path in the OS file manager
 * POST /api/clear-history         — clear chat history for a session
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../../config/config';
import { getSession, clearHistory, getWorkspace, getCreativeMode, normalizeCreativeMode, setCreativeMode, getCanvasProjectRoot, getCanvasProjectLabel, setCanvasProject, getCanvasProjectLink, setCanvasProjectLink, type CanvasProjectLink } from '../session';
import { hookBus } from '../hooks';
import { browserPreviewScreenshot } from '../browser-tools';
import { sessionCanvasFiles, addCanvasFile, removeCanvasFile } from './canvas-state';
import { getVault } from '../../security/vault';
import { evaluateGatewayRequest, resolveGatewayAuthToken } from '../gateway-auth';
import {
  type CreativeRenderJobRecord as NormalizedCreativeRenderJobRecord,
  appendCreativeRenderJobError,
  buildCreativeRenderManifest,
  buildCreativeRenderWorkerInput,
  bumpCreativeRenderJobAttempt,
  cloneData as creativeCloneData,
  clampNumber as creativeClampNumber,
  isCreativeRenderJobTerminal as isNormalizedCreativeRenderJobTerminal,
  isPlainObject as isCreativePlainObject,
  normalizeCreativeRenderExportOptions,
  normalizeCreativeRenderFormat,
  normalizeCreativeRenderJobRecord,
  normalizeCreativeRenderJobStatus as normalizeCreativeRenderJobStatusValue,
  normalizeCreativeSceneDoc,
  normalizeCreativeSceneEnvelope,
  summarizeCreativeSceneDoc as summarizeNormalizedCreativeSceneDoc,
} from '../creative/contracts';
import {
  analyzeCreativeAudioSource,
  enrichCreativeAudioTrack,
  enrichCreativeSceneDocAudio,
} from '../creative/audio';
import {
  createCreativeMotionPreview,
  getCreativeMotionCatalog,
  prepareCreativeMotionTemplate,
} from '../creative/motion-runtime';
import {
  analyzeCreativeAsset,
  generateCreativeAssetPlaceholder,
  importCreativeAsset,
  readCreativeAssetIndex,
  searchCreativeAssets,
} from '../creative/assets';
import { extractCreativeLayers, refineCreativeLayerCutout } from '../creative/layer-extraction';
import { listCreativeModelStatus } from '../creative/onnx/model-paths';
import {
  getCreativePremiumTemplate,
  listCreativePremiumTemplates,
} from '../creative/templates';
import {
  buildHtmlMotionCompositionMetadata,
  lintHtmlMotionComposition,
} from '../creative/html-motion-spec';
import {
  listHtmlMotionAdapterSnippets,
} from '../creative/html-motion-adapters';
import {
  listHtmlMotionBlocks,
  renderHtmlMotionBlock,
} from '../creative/html-motion-blocks';
import {
  applyHtmlMotionTemplate,
  summarizeHtmlMotionTemplates,
} from '../creative/html-motion-templates';

export const router = Router();
const archiver = require('archiver');
const mammoth: any = require('mammoth');
const XLSX: any = require('xlsx');
const JSZip: any = require('jszip');

const execFileAsync = promisify(execFile);

let _requireGatewayAuth: any;
let _broadcastWS: (msg: any) => void = () => {};

export function initCanvasRouter(deps: {
  requireGatewayAuth: any;
  broadcastWS: (msg: any) => void;
}): void {
  _requireGatewayAuth = deps.requireGatewayAuth;
  _broadcastWS = deps.broadcastWS;
}

function getWorkspaceRoot(): string {
  return getConfig().getWorkspacePath();
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = path.resolve(String(basePath || ''));
  const target = path.resolve(String(targetPath || ''));
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveCanvasPath(rawPath: string): { workspacePath: string; absPath: string; relPath: string; inWorkspace: boolean } {
  const workspacePath = getWorkspaceRoot();
  const candidatePath = path.isAbsolute(rawPath) ? rawPath : path.join(workspacePath, rawPath);
  const absPath = path.resolve(candidatePath);
  const relPath = path.relative(workspacePath, absPath).replace(/\\/g, '/');
  const inWorkspace = !(relPath.startsWith('..') || path.isAbsolute(relPath));
  const cfg = getConfig().getConfig() as any;
  const allowedPaths = Array.isArray(cfg?.tools?.permissions?.files?.allowed_paths)
    ? cfg.tools.permissions.files.allowed_paths
        .map((allowed: any) => String(allowed || '').trim())
        .filter(Boolean)
        .map((allowed: string) => path.resolve(allowed))
    : [];
  const isAllowed = allowedPaths.some((allowed: string) => isPathInside(allowed, absPath));
  if (!inWorkspace && !isAllowed) {
    throw new Error('Path outside workspace or allowed directories');
  }
  return { workspacePath, absPath, relPath, inWorkspace };
}

function sanitizeRelativeUploadPath(rawPath: string): string {
  const segments = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._\-() ]/g, '_'))
    .filter((segment) => segment !== '.' && segment !== '..');
  return segments.join('/');
}

function ensureInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.ppt':
      return 'application/vnd.ms-powerpoint';
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

type CanvasDocumentPreviewKind = 'pdf' | 'docx' | 'spreadsheet' | 'presentation' | 'unsupported';

function escapePreviewHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeXmlEntities(value: string): string {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&');
}

function formatDocumentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 bytes';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} bytes`;
}

function getCanvasDocumentPreviewKind(filePath: string): CanvasDocumentPreviewKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    case '.xlsx':
    case '.xls':
      return 'spreadsheet';
    case '.pptx':
      return 'presentation';
    default:
      return 'unsupported';
  }
}

function buildCanvasDocumentShell(options: {
  title: string;
  eyebrow: string;
  summary: string;
  bodyHtml: string;
  metaHtml?: string;
  extraHead?: string;
  footerHtml?: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapePreviewHtml(options.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef3fb;
      --panel: rgba(255,255,255,0.82);
      --panel-strong: #ffffff;
      --line: #d7e1ef;
      --line-strong: #c5d3e6;
      --text: #17243b;
      --muted: #5f6f86;
      --accent: #2e6bff;
      --accent-soft: rgba(46,107,255,0.12);
      --shadow: 0 18px 48px rgba(23, 36, 59, 0.12);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "Segoe UI", Inter, system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(46,107,255,0.12), transparent 34%),
        radial-gradient(circle at top right, rgba(22,163,74,0.08), transparent 26%),
        linear-gradient(180deg, #f7faff 0%, var(--bg) 100%);
    }
    .preview-shell {
      min-height: 100vh;
      padding: 28px clamp(18px, 4vw, 36px) 42px;
    }
    .preview-header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: grid;
      gap: 10px;
      margin: 0 auto 22px;
      max-width: 1200px;
      padding: 16px 18px;
      border: 1px solid rgba(215,225,239,0.92);
      border-radius: 22px;
      background: rgba(255,255,255,0.78);
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 36px rgba(23,36,59,0.08);
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .preview-title {
      margin: 0;
      font-size: clamp(22px, 3vw, 30px);
      line-height: 1.15;
      word-break: break-word;
    }
    .preview-summary {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
      max-width: 920px;
    }
    .preview-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .preview-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--accent-soft);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .preview-meta-item strong {
      color: var(--text);
      font-weight: 800;
    }
    .preview-content {
      margin: 0 auto;
      max-width: 1200px;
    }
    .stack {
      display: grid;
      gap: 18px;
    }
    .panel-card {
      background: var(--panel-strong);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--shadow);
    }
    .docx-page {
      width: min(920px, calc(100vw - 36px));
      margin: 0 auto;
      padding: clamp(22px, 5vw, 44px);
      line-height: 1.75;
      color: var(--text);
      background: var(--panel-strong);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--shadow);
    }
    .docx-page > :first-child { margin-top: 0; }
    .docx-page h1, .docx-page h2, .docx-page h3, .docx-page h4 { line-height: 1.2; margin: 1.2em 0 0.45em; }
    .docx-page p, .docx-page li { margin: 0.6em 0; }
    .docx-page table {
      width: 100%;
      border-collapse: collapse;
      margin: 18px 0;
      font-size: 14px;
    }
    .docx-page th, .docx-page td {
      border: 1px solid var(--line);
      padding: 8px 10px;
      vertical-align: top;
    }
    .docx-page img {
      max-width: 100%;
      height: auto;
      border-radius: 14px;
      display: block;
      margin: 16px auto;
      box-shadow: 0 12px 24px rgba(23,36,59,0.12);
    }
    .docx-page blockquote {
      margin: 18px 0;
      padding: 12px 16px;
      border-left: 4px solid var(--accent);
      background: rgba(46,107,255,0.06);
      border-radius: 0 16px 16px 0;
      color: var(--muted);
    }
    .sheet-nav {
      position: sticky;
      top: 112px;
      z-index: 4;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.86);
      backdrop-filter: blur(10px);
    }
    .sheet-tab {
      border: 1px solid var(--line);
      background: var(--panel-strong);
      color: var(--muted);
      border-radius: 999px;
      padding: 9px 14px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .sheet-tab:hover,
    .sheet-tab.active {
      border-color: rgba(46,107,255,0.35);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .sheet-panel {
      padding: 18px;
    }
    .sheet-panel[hidden] { display: none; }
    .sheet-panel h2 {
      margin: 0 0 14px;
      font-size: 20px;
    }
    .sheet-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: #ffffff;
    }
    .sheet-table th,
    .sheet-table td {
      min-width: 72px;
      border: 1px solid var(--line);
      padding: 8px 10px;
      vertical-align: top;
      white-space: pre-wrap;
    }
    .sheet-table tr:nth-child(even) td {
      background: rgba(95,111,134,0.04);
    }
    .pptx-toc {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 18px;
    }
    .pptx-toc a {
      text-decoration: none;
      color: var(--accent);
      background: var(--accent-soft);
      border: 1px solid rgba(46,107,255,0.22);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 800;
    }
    .pptx-slide {
      scroll-margin-top: 130px;
      padding: 22px;
      aspect-ratio: 16 / 9;
      min-height: 320px;
      display: grid;
      gap: 16px;
      align-content: start;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,250,255,0.98) 100%);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .pptx-slide-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
    }
    .pptx-slide-header span {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .pptx-slide h2 {
      margin: 0;
      font-size: clamp(22px, 3vw, 30px);
      line-height: 1.18;
    }
    .pptx-images {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }
    .pptx-images img {
      width: 100%;
      height: 100%;
      min-height: 140px;
      object-fit: contain;
      border-radius: 16px;
      background: #f7faff;
      border: 1px solid var(--line);
      padding: 10px;
    }
    .pptx-copy {
      display: grid;
      gap: 10px;
      color: var(--text);
      line-height: 1.65;
    }
    .pptx-copy p {
      margin: 0;
      font-size: 15px;
    }
    .preview-empty {
      padding: 32px;
      text-align: center;
      color: var(--muted);
    }
    .preview-notice {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px dashed var(--line-strong);
      background: rgba(95,111,134,0.05);
      color: var(--muted);
      line-height: 1.6;
    }
    .preview-notice ul {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    .preview-notice li {
      margin: 6px 0;
    }
  </style>
  ${options.extraHead || ''}
</head>
<body>
  <main class="preview-shell">
    <section class="preview-header">
      <div class="eyebrow">${escapePreviewHtml(options.eyebrow)}</div>
      <h1 class="preview-title">${escapePreviewHtml(options.title)}</h1>
      <p class="preview-summary">${escapePreviewHtml(options.summary)}</p>
      ${options.metaHtml ? `<div class="preview-meta">${options.metaHtml}</div>` : ''}
    </section>
    <section class="preview-content">
      ${options.bodyHtml}
      ${options.footerHtml || ''}
    </section>
  </main>
</body>
</html>`;
}

function stripWorkbookHtmlShell(html: string): string {
  const bodyMatch = String(html || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : String(html || '');
}

function getXmlAttribute(rawAttributes: string, name: string): string {
  const match = String(rawAttributes || '').match(new RegExp(`${name}=(["'])(.*?)\\1`, 'i'));
  return match?.[2] || '';
}

function parseXmlRelationships(xml: string): Map<string, string> {
  const relations = new Map<string, string>();
  const pattern = /<Relationship\b([^>]*?)\/?>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(String(xml || ''))) !== null) {
    const attrs = match[1] || '';
    const id = getXmlAttribute(attrs, 'Id');
    const target = getXmlAttribute(attrs, 'Target');
    if (id && target) relations.set(id, target);
  }
  return relations;
}

function normalizeZipTargetPath(basePath: string, relativeTarget: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePath), relativeTarget));
}

async function buildDocxPreviewHtml(absPath: string, stat: fs.Stats): Promise<string> {
  const result = await mammoth.convertToHtml(
    { path: absPath },
    {
      convertImage: mammoth.images.imgElement((image: any) => image.read('base64').then((base64: string) => ({
        src: `data:${String(image.contentType || 'image/png')};base64,${base64}`,
      }))),
    },
  );
  const notices = Array.isArray(result?.messages) ? result.messages : [];
  const metaHtml = [
    `<div class="preview-meta-item"><strong>Type</strong> DOCX document</div>`,
    `<div class="preview-meta-item"><strong>Size</strong> ${escapePreviewHtml(formatDocumentSize(stat.size))}</div>`,
  ].join('');
  const footerHtml = notices.length
    ? `<section class="preview-notice">
         Some Word formatting may not map perfectly into the canvas preview.
         <ul>${notices.slice(0, 6).map((message: any) => `<li>${escapePreviewHtml(String(message?.message || message || 'Formatting notice'))}</li>`).join('')}</ul>
       </section>`
    : '';
  const bodyHtml = result?.value && String(result.value).trim()
    ? `<article class="docx-page">${result.value}</article>`
    : `<div class="panel-card preview-empty">This document did not contain previewable body content.</div>`;
  return buildCanvasDocumentShell({
    title: path.basename(absPath),
    eyebrow: 'Word Document',
    summary: 'Converted into a scrollable reading view for the canvas.',
    metaHtml,
    bodyHtml,
    footerHtml,
  });
}

async function buildSpreadsheetPreviewHtml(absPath: string, stat: fs.Stats): Promise<string> {
  const workbook = XLSX.readFile(absPath, { cellHTML: true, cellNF: true, cellStyles: true });
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  const metaHtml = [
    `<div class="preview-meta-item"><strong>Type</strong> Spreadsheet</div>`,
    `<div class="preview-meta-item"><strong>Sheets</strong> ${escapePreviewHtml(String(sheetNames.length))}</div>`,
    `<div class="preview-meta-item"><strong>Size</strong> ${escapePreviewHtml(formatDocumentSize(stat.size))}</div>`,
  ].join('');
  if (!sheetNames.length) {
    return buildCanvasDocumentShell({
      title: path.basename(absPath),
      eyebrow: 'Spreadsheet',
      summary: 'This workbook does not contain any sheets that can be previewed.',
      metaHtml,
      bodyHtml: '<div class="panel-card preview-empty">No sheets were found in this workbook.</div>',
    });
  }
  const tabsHtml = sheetNames.map((sheetName: string, index: number) => (
    `<button class="sheet-tab${index === 0 ? ' active' : ''}" data-sheet-target="sheet-${index}">${escapePreviewHtml(sheetName)}</button>`
  )).join('');
  const panelsHtml = sheetNames.map((sheetName: string, index: number) => {
    const sheet = workbook.Sheets?.[sheetName];
    const rawHtml = sheet ? String(XLSX.utils.sheet_to_html(sheet)) : '';
    const tableHtml = stripWorkbookHtmlShell(rawHtml).replace(/<table\b/i, '<table class="sheet-table"');
    return `<section class="panel-card sheet-panel" data-sheet-panel="sheet-${index}"${index === 0 ? '' : ' hidden'}>
      <h2>${escapePreviewHtml(sheetName)}</h2>
      <div style="overflow:auto">${tableHtml || '<div class="preview-empty">This sheet does not contain previewable cells.</div>'}</div>
    </section>`;
  }).join('');
  return buildCanvasDocumentShell({
    title: path.basename(absPath),
    eyebrow: 'Spreadsheet',
    summary: 'Switch between sheets and scroll through the workbook directly in the canvas.',
    metaHtml,
    bodyHtml: `<div class="sheet-nav">${tabsHtml}</div><div class="stack">${panelsHtml}</div>`,
    extraHead: `<script>
      window.addEventListener('DOMContentLoaded', () => {
        const buttons = Array.from(document.querySelectorAll('[data-sheet-target]'));
        const panels = Array.from(document.querySelectorAll('[data-sheet-panel]'));
        const activate = (target) => {
          panels.forEach((panel) => { panel.hidden = panel.dataset.sheetPanel !== target; });
          buttons.forEach((button) => { button.classList.toggle('active', button.dataset.sheetTarget === target); });
        };
        buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.sheetTarget)));
        if (buttons[0]) activate(buttons[0].dataset.sheetTarget);
      });
    </script>`,
  });
}

async function buildPptxPreviewHtml(absPath: string, stat: fs.Stats): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(absPath));
  const readZipText = async (entryPath: string): Promise<string> => {
    const file = zip.file(entryPath);
    return file ? String(await file.async('string')) : '';
  };
  const presentationXml = await readZipText('ppt/presentation.xml');
  const presentationRelsXml = await readZipText('ppt/_rels/presentation.xml.rels');
  const presentationRels = parseXmlRelationships(presentationRelsXml);
  const orderedSlidePaths: string[] = [];
  const slideRefPattern = /<p:sldId\b([^>]*?)\/?>/gi;
  let slideRefMatch: RegExpExecArray | null = null;
  while ((slideRefMatch = slideRefPattern.exec(presentationXml)) !== null) {
    const relationId = getXmlAttribute(slideRefMatch[1] || '', 'r:id');
    const target = relationId ? presentationRels.get(relationId) : '';
    if (!target) continue;
    orderedSlidePaths.push(normalizeZipTargetPath('ppt/presentation.xml', target));
  }
  if (!orderedSlidePaths.length) {
    zip.forEach((entryPath: string) => {
      if (/^ppt\/slides\/slide\d+\.xml$/i.test(entryPath)) orderedSlidePaths.push(entryPath);
    });
    orderedSlidePaths.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }

  const slides = [] as Array<{ title: string; paragraphs: string[]; images: string[] }>;
  for (const slidePath of orderedSlidePaths) {
    const slideXml = await readZipText(slidePath);
    if (!slideXml) continue;
    const relsPath = path.posix.join(path.posix.dirname(slidePath), '_rels', `${path.posix.basename(slidePath)}.rels`);
    const slideRels = parseXmlRelationships(await readZipText(relsPath));

    const paragraphPattern = /<a:p\b[\s\S]*?<\/a:p>/gi;
    const paragraphs: string[] = [];
    let paragraphMatch: RegExpExecArray | null = null;
    while ((paragraphMatch = paragraphPattern.exec(slideXml)) !== null) {
      const textRuns = Array.from(paragraphMatch[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
        .map((match) => decodeXmlEntities(match[1] || ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (textRuns) paragraphs.push(textRuns);
    }
    const uniqueParagraphs = Array.from(new Set(paragraphs));

    const imageIds = Array.from(slideXml.matchAll(/<a:blip\b[^>]*r:embed=(["'])([^"']+)\1/gi))
      .map((match) => match[2])
      .filter(Boolean);
    const images: string[] = [];
    for (const imageId of imageIds) {
      const target = slideRels.get(imageId);
      if (!target) continue;
      const assetPath = normalizeZipTargetPath(slidePath, target);
      const file = zip.file(assetPath);
      if (!file) continue;
      const base64 = await file.async('base64');
      const mimeType = String(guessContentType(assetPath) || 'application/octet-stream').split(';')[0];
      images.push(`data:${mimeType};base64,${base64}`);
    }
    slides.push({
      title: uniqueParagraphs[0] || `Slide ${slides.length + 1}`,
      paragraphs: uniqueParagraphs.length > 1 ? uniqueParagraphs.slice(1) : [],
      images,
    });
  }

  const metaHtml = [
    `<div class="preview-meta-item"><strong>Type</strong> Slide deck</div>`,
    `<div class="preview-meta-item"><strong>Slides</strong> ${escapePreviewHtml(String(slides.length))}</div>`,
    `<div class="preview-meta-item"><strong>Size</strong> ${escapePreviewHtml(formatDocumentSize(stat.size))}</div>`,
  ].join('');
  if (!slides.length) {
    return buildCanvasDocumentShell({
      title: path.basename(absPath),
      eyebrow: 'Slide Deck',
      summary: 'The presentation was uploaded successfully, but no slide preview data could be extracted.',
      metaHtml,
      bodyHtml: '<div class="panel-card preview-empty">No slide previews were available for this presentation.</div>',
    });
  }
  const tocHtml = `<nav class="pptx-toc">${slides.map((slide, index) => (
    `<a href="#slide-${index + 1}">${escapePreviewHtml(`Slide ${index + 1}`)}</a>`
  )).join('')}</nav>`;
  const slidesHtml = slides.map((slide, index) => `
    <section id="slide-${index + 1}" class="pptx-slide">
      <div class="pptx-slide-header">
        <span>Slide ${index + 1}</span>
      </div>
      <h2>${escapePreviewHtml(slide.title)}</h2>
      ${slide.images.length ? `<div class="pptx-images">${slide.images.map((src) => `<img src="${src}" alt="Slide ${index + 1} image">`).join('')}</div>` : ''}
      <div class="pptx-copy">
        ${(slide.paragraphs.length ? slide.paragraphs : ['This slide contains layout or media content without extractable body text.'])
          .map((paragraph) => `<p>${escapePreviewHtml(paragraph)}</p>`).join('')}
      </div>
    </section>
  `).join('');
  return buildCanvasDocumentShell({
    title: path.basename(absPath),
    eyebrow: 'Slide Deck',
    summary: 'Slides are stacked in a scrollable deck so you can skim titles, body copy, and embedded images in the canvas.',
    metaHtml,
    bodyHtml: `${tocHtml}<div class="stack">${slidesHtml}</div>`,
    footerHtml: `<section class="preview-notice">This preview focuses on readable slide content and embedded media. Advanced positioning, animations, and some shapes may not map perfectly.</section>`,
  });
}

function buildUnsupportedDocumentPreviewHtml(absPath: string, stat: fs.Stats): string {
  const ext = path.extname(absPath).toLowerCase() || 'binary';
  const metaHtml = [
    `<div class="preview-meta-item"><strong>Type</strong> ${escapePreviewHtml(ext.replace(/^\./, '').toUpperCase())}</div>`,
    `<div class="preview-meta-item"><strong>Size</strong> ${escapePreviewHtml(formatDocumentSize(stat.size))}</div>`,
  ].join('');
  return buildCanvasDocumentShell({
    title: path.basename(absPath),
    eyebrow: 'Binary File',
    summary: 'This file is pinned to the canvas, but that format does not have an inline renderer yet.',
    metaHtml,
    bodyHtml: `<div class="panel-card preview-empty">
      <div>
        The assistant can still work with this file by exact workspace path.
      </div>
      <div style="margin-top:12px;font-family:Cascadia Code,Consolas,monospace;font-size:12px;color:#51627c">
        ${escapePreviewHtml(absPath)}
      </div>
    </div>`,
  });
}

function isExternalAssetRef(rawRef: string): boolean {
  const ref = String(rawRef || '').trim().toLowerCase();
  return !ref
    || ref.startsWith('data:')
    || ref.startsWith('mailto:')
    || ref.startsWith('javascript:')
    || ref.startsWith('#')
    || /^https?:\/\//.test(ref)
    || /^\/\//.test(ref);
}

function stripAssetQuery(rawRef: string): string {
  return String(rawRef || '').split('#')[0].split('?')[0];
}

function resolveProjectAssetPath(projectRoot: string, fromFilePath: string, rawRef: string): string | null {
  if (isExternalAssetRef(rawRef)) return null;
  const cleanedRef = stripAssetQuery(rawRef);
  if (!cleanedRef) return null;
  const candidate = cleanedRef.startsWith('/')
    ? path.join(projectRoot, cleanedRef.replace(/^\/+/, ''))
    : path.resolve(path.dirname(fromFilePath), cleanedRef);
  if (!isPathInside(projectRoot, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

function toDataUri(filePath: string): string {
  const mime = guessContentType(filePath).split(';')[0] || 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function inlineCssUrls(cssText: string, cssFilePath: string, projectRoot: string): string {
  return String(cssText || '').replace(/url\(([^)]+)\)/gi, (full, rawValue) => {
    const unwrapped = String(rawValue || '').trim().replace(/^['"]|['"]$/g, '');
    const assetPath = resolveProjectAssetPath(projectRoot, cssFilePath, unwrapped);
    if (!assetPath) return full;
    return `url("${toDataUri(assetPath)}")`;
  });
}

function inlineStandaloneHtml(entryFilePath: string, projectRoot: string): string {
  let html = fs.readFileSync(entryFilePath, 'utf-8');

  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, attrs, cssText) => {
    const inlinedCss = inlineCssUrls(cssText, entryFilePath, projectRoot);
    return `<style${attrs}>${inlinedCss}</style>`;
  });

  html = html.replace(/<link\b([^>]*?)>/gi, (full, attrs) => {
    const hrefMatch = attrs.match(/\bhref=(['"])([^'"]+)\1/i);
    if (!hrefMatch) return full;
    const href = hrefMatch[2];
    const assetPath = resolveProjectAssetPath(projectRoot, entryFilePath, href);
    if (!assetPath) return full;
    const relMatch = attrs.match(/\brel=(['"])([^'"]+)\1/i);
    const relValue = String(relMatch?.[2] || '').toLowerCase();
    if (/\bstylesheet\b/.test(relValue)) {
      const cssText = inlineCssUrls(fs.readFileSync(assetPath, 'utf-8'), assetPath, projectRoot);
      return `<style data-exported-from="${path.basename(assetPath)}">${cssText}</style>`;
    }
    if (/\b(icon|shortcut icon|apple-touch-icon)\b/.test(relValue)) {
      return `<link${attrs.replace(hrefMatch[0], `href="${toDataUri(assetPath)}"`)}>`;
    }
    return full;
  });

  html = html.replace(/<script\b([^>]*?)\bsrc=(['"])([^'"]+)\2([^>]*)><\/script>/gi, (full, before, quote, src, after) => {
    const assetPath = resolveProjectAssetPath(projectRoot, entryFilePath, src);
    if (!assetPath) return full;
    const scriptText = fs.readFileSync(assetPath, 'utf-8');
    return `<script${before}${after}>\n${scriptText}\n</script>`;
  });

  html = html.replace(/<(img|audio|video|source)\b([^>]*?)\bsrc=(['"])([^'"]+)\3([^>]*)>/gi, (full, tag, before, quote, src, after) => {
    const assetPath = resolveProjectAssetPath(projectRoot, entryFilePath, src);
    if (!assetPath) return full;
    return `<${tag}${before}src="${toDataUri(assetPath)}"${after}>`;
  });

  html = html.replace(/<video\b([^>]*?)\bposter=(['"])([^'"]+)\2([^>]*)>/gi, (full, before, quote, poster, after) => {
    const assetPath = resolveProjectAssetPath(projectRoot, entryFilePath, poster);
    if (!assetPath) return full;
    return `<video${before}poster="${toDataUri(assetPath)}"${after}>`;
  });

  return html;
}

function buildWorkspaceTree(dir: string, base = ''): any[] {
  const results: any[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push({
          type: 'dir',
          name: entry.name,
          path: relPath,
          children: buildWorkspaceTree(absPath, relPath),
        });
      } else {
        results.push({ type: 'file', name: entry.name, path: relPath });
      }
    }
  } catch {
    return results;
  }
  return results;
}

function sanitizeCreativeStorageSegment(raw: string, fallback = 'default'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function sanitizeCreativeSceneFilename(raw: string, fallback = 'creative-scene.json'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-');
  const base = cleaned || fallback;
  return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
}

function sanitizeCreativeAssetFilename(raw: string | undefined, fallback = 'creative-export.bin'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-');
  return cleaned || fallback;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = String(mimeType || '').split(';')[0]?.trim().toLowerCase() || '';
  switch (normalized) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/svg+xml': return '.svg';
    case 'application/pdf': return '.pdf';
    case 'video/webm': return '.webm';
    case 'video/mp4': return '.mp4';
    case 'image/gif': return '.gif';
    default: return '';
  }
}

function creativeFormatFromMimeType(mimeType: string, fallback = 'bin'): string {
  const ext = extensionForMimeType(mimeType).replace(/^\./, '').trim().toLowerCase();
  return ext || fallback;
}

function getDefaultCreativeStorageRoot(sessionId: string): string {
  return path.join(getWorkspaceRoot(), 'creative-projects', sanitizeCreativeStorageSegment(sessionId, 'default'));
}

function buildCreativeStorageRelativePath(workspacePath: string, absPath: string): string {
  const relative = path.relative(workspacePath, absPath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : absPath.replace(/\\/g, '/');
}

function resolveCreativeStorage(sessionId: string, requestedRoot?: string | null): {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath: string;
  creativeDir: string;
  scenesDir: string;
  exportsDir: string;
  renderJobsDir: string;
  usesProjectRoot: boolean;
} {
  const workspacePath = getWorkspaceRoot();
  const sessionProjectRoot = getCanvasProjectRoot(sessionId);
  const explicitRoot = String(requestedRoot || '').trim();
  let rootAbsPath = '';
  let usesProjectRoot = false;

  if (explicitRoot) {
    rootAbsPath = resolveCanvasPath(explicitRoot).absPath;
    usesProjectRoot = !!sessionProjectRoot && path.resolve(sessionProjectRoot) === rootAbsPath;
  } else if (sessionProjectRoot) {
    rootAbsPath = resolveCanvasPath(sessionProjectRoot).absPath;
    usesProjectRoot = true;
  } else {
    rootAbsPath = getDefaultCreativeStorageRoot(sessionId);
  }

  fs.mkdirSync(rootAbsPath, { recursive: true });
  const creativeDir = path.join(rootAbsPath, 'prometheus-creative');
  const scenesDir = path.join(creativeDir, 'scenes');
  const exportsDir = path.join(creativeDir, 'exports');
  const renderJobsDir = path.join(creativeDir, 'render-jobs');
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(renderJobsDir, { recursive: true });

  return {
    workspacePath,
    rootAbsPath,
    rootRelPath: buildCreativeStorageRelativePath(workspacePath, rootAbsPath),
    creativeDir,
    scenesDir,
    exportsDir,
    renderJobsDir,
    usesProjectRoot,
  };
}

function resolveCreativeAudioSourcePath(
  storage: ReturnType<typeof resolveCreativeStorage>,
  rawSource: string,
): string {
  const trimmed = String(rawSource || '').trim();
  if (!trimmed) throw new Error('Creative audio source is required.');
  if (path.isAbsolute(trimmed)) {
    return resolveCanvasPath(trimmed).absPath;
  }
  const preferred = path.resolve(storage.rootAbsPath, trimmed);
  if (fs.existsSync(preferred)) {
    return resolveCanvasPath(preferred).absPath;
  }
  return resolveCanvasPath(trimmed).absPath;
}

async function normalizeCreativeSceneDocForStorage(
  storage: ReturnType<typeof resolveCreativeStorage>,
  rawDoc: any,
  options: { forceAudioAnalysis?: boolean } = {},
): Promise<ReturnType<typeof normalizeCreativeSceneDoc>> {
  const baseDoc = normalizeCreativeSceneDoc(rawDoc);
  if (!baseDoc.audioTrack.source) return baseDoc;
  return enrichCreativeSceneDocAudio(storage, baseDoc, {
    resolveLocalPath: (rawSource) => resolveCreativeAudioSourcePath(storage, rawSource),
    forceAnalysis: options.forceAudioAnalysis === true,
  });
}

type CreativeRenderJobStatus = NormalizedCreativeRenderJobRecord['status'];
type CreativeRenderJobRecord = NormalizedCreativeRenderJobRecord;

function generateCreativeRenderJobId(): string {
  return `render_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCreativeRenderJobId(raw: string, fallback = 'render-job'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

function normalizeCreativeRenderJobStatus(raw: any, fallback: CreativeRenderJobStatus = 'queued'): CreativeRenderJobStatus {
  return normalizeCreativeRenderJobStatusValue(raw, fallback);
}

function isCreativeRenderJobTerminal(status: any): boolean {
  return isNormalizedCreativeRenderJobTerminal(status);
}

function getCreativeRenderJobFilePath(storage: ReturnType<typeof resolveCreativeStorage>, jobId: string): string {
  return path.join(storage.renderJobsDir, `${sanitizeCreativeRenderJobId(jobId)}.json`);
}

function buildCreativeRenderJobEntry(
  workspacePath: string,
  rootAbsPath: string,
  absPath: string,
  record: CreativeRenderJobRecord,
  options: { includePayload?: boolean } = {},
): any {
  const normalizedRecord = normalizeCreativeRenderJobRecord(record);
  const workerInput = buildCreativeRenderWorkerInput(normalizedRecord);
  return {
    kind: 'render_job',
    id: normalizedRecord.id,
    name: `${String(normalizedRecord.format || 'render').toUpperCase()} render`,
    format: normalizedRecord.format,
    renderer: normalizedRecord.renderer,
    status: normalizedRecord.status,
    progress: creativeClampNumber(Number(normalizedRecord.progress) || 0, 0, 1),
    progressLabel: normalizedRecord.progressLabel || null,
    cancelRequested: normalizedRecord.cancelRequested === true,
    error: normalizedRecord.error || null,
    lastError: normalizedRecord.lastError || null,
    errorHistory: creativeCloneData(normalizedRecord.errorHistory || []),
    attemptCount: normalizedRecord.attemptCount,
    maxAttempts: normalizedRecord.maxAttempts,
    retryable: normalizedRecord.retryable === true,
    workerToken: normalizedRecord.workerToken || null,
    path: buildCreativeStorageRelativePath(workspacePath, absPath),
    relativePath: buildCreativeStorageRelativePath(rootAbsPath, absPath),
    absPath,
    createdAt: normalizedRecord.requestedAt,
    updatedAt: normalizedRecord.updatedAt,
    requestedAt: normalizedRecord.requestedAt,
    startedAt: normalizedRecord.startedAt,
    finishedAt: normalizedRecord.finishedAt,
    creativeMode: normalizedRecord.creativeMode || null,
    summary: creativeCloneData(normalizedRecord.summary || null),
    outputFilename: normalizedRecord.output?.filename || null,
    outputPath: normalizedRecord.output?.path || null,
    outputAbsPath: normalizedRecord.output?.absPath || null,
    outputMimeType: normalizedRecord.output?.mimeType || null,
    outputSize: Number.isFinite(Number(normalizedRecord.output?.size)) ? Number(normalizedRecord.output?.size) : null,
    captureMimeType: normalizedRecord.metadata?.sourceMimeType || null,
    captureFormat: normalizedRecord.metadata?.sourceFormat || null,
    deliveredMimeType: normalizedRecord.metadata?.outputMimeType || normalizedRecord.output?.mimeType || null,
    deliveredFormat: normalizedRecord.metadata?.outputFormat || (normalizedRecord.output?.mimeType ? creativeFormatFromMimeType(normalizedRecord.output.mimeType, String(normalizedRecord.format || 'bin')) : String(normalizedRecord.format || 'bin')),
    serverFinishStatus: normalizedRecord.metadata?.serverFinishStatus || null,
    serverFinishReason: normalizedRecord.metadata?.serverFinishReason || null,
	    preflight: creativeCloneData(normalizedRecord.preflight || null),
	    manifest: creativeCloneData(buildCreativeRenderManifest(normalizedRecord)),
	    workerInput: creativeCloneData(workerInput),
    exportOptions: creativeCloneData(normalizedRecord.exportOptions || null),
    metadata: creativeCloneData(normalizedRecord.metadata || null),
    sceneVersion: normalizedRecord.sceneDoc?.version || null,
    audioTrack: normalizedRecord.sceneDoc?.audioTrack ? creativeCloneData(normalizedRecord.sceneDoc.audioTrack) : null,
    sceneDoc: options.includePayload === true ? creativeCloneData(normalizedRecord.sceneDoc) : undefined,
  };
}

function readCreativeRenderJobRecord(storage: ReturnType<typeof resolveCreativeStorage>, jobId: string): { absPath: string; record: CreativeRenderJobRecord } {
  const absPath = getCreativeRenderJobFilePath(storage, jobId);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error('Creative render job not found.');
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    absPath,
    record: normalizeCreativeRenderJobRecord(parsed, {
      id: sanitizeCreativeRenderJobId(parsed?.id || jobId, sanitizeCreativeRenderJobId(jobId)),
      sessionId: String(parsed?.sessionId || '').trim(),
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      renderer: 'browser-hybrid',
      format: 'render',
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      maxAttempts: 2,
      retryable: true,
    }) as CreativeRenderJobRecord,
  };
}

function writeCreativeRenderJobRecord(storage: ReturnType<typeof resolveCreativeStorage>, record: CreativeRenderJobRecord): { absPath: string; entry: any } {
  const absPath = getCreativeRenderJobFilePath(storage, record.id);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const normalizedRecord = normalizeCreativeRenderJobRecord(record, {
    storageRoot: storage.rootAbsPath,
    storageRootRelative: storage.rootRelPath,
    usesProjectRoot: storage.usesProjectRoot,
  }) as CreativeRenderJobRecord;
  fs.writeFileSync(absPath, JSON.stringify(normalizedRecord, null, 2), 'utf-8');
  return {
    absPath,
    entry: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, absPath, normalizedRecord),
  };
}

function collectCreativeRenderJobEntries(storage: ReturnType<typeof resolveCreativeStorage>): any[] {
  const results: any[] = [];
  if (!fs.existsSync(storage.renderJobsDir)) return results;
  const entries = fs.readdirSync(storage.renderJobsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => right.name.localeCompare(left.name));
  for (const entry of entries) {
    const absPath = path.join(storage.renderJobsDir, entry.name);
    try {
      const parsed = readCreativeRenderJobRecord(storage, path.basename(entry.name, '.json'));
      results.push(buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, absPath, parsed.record));
    } catch (err: any) {
      results.push({
        kind: 'render_job',
        id: path.basename(entry.name, '.json'),
        name: entry.name,
        status: 'failed',
        progress: 0,
        progressLabel: null,
        error: String(err?.message || 'Could not parse render job metadata'),
        path: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
        relativePath: buildCreativeStorageRelativePath(storage.rootAbsPath, absPath),
        absPath,
        createdAt: null,
        updatedAt: null,
        requestedAt: null,
        startedAt: null,
        finishedAt: null,
        creativeMode: null,
        summary: null,
        outputFilename: null,
        outputPath: null,
        outputAbsPath: null,
        outputMimeType: null,
        outputSize: null,
      });
    }
  }
  return results.sort((left, right) => {
    const leftTime = Date.parse(String(left?.updatedAt || left?.createdAt || '')) || 0;
    const rightTime = Date.parse(String(right?.updatedAt || right?.createdAt || '')) || 0;
    return rightTime - leftTime;
  });
}

function getGatewayBaseUrl(): string {
  const cfg = getConfig().getConfig() as any;
  const port = Number(cfg?.gateway?.port || 18789);
  return `http://127.0.0.1:${port}`;
}

function getCreativeRenderUiRoot(): string {
  return path.resolve(getWorkspaceRoot(), 'web-ui');
}

function resolveCreativeRenderUiPath(rawPath: string): string {
  const uiRoot = getCreativeRenderUiRoot();
  const normalized = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  const candidate = path.resolve(uiRoot, normalized || 'index.html');
  if (!isPathInside(uiRoot, candidate) && candidate !== uiRoot) {
    throw new Error('Creative render UI path is outside the UI root.');
  }
  let resolvedPath = candidate;
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, 'index.html');
  }
  return resolvedPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPlaywrightModuleForCreativeRender(): Promise<any> {
  return Function('return import("playwright")')() as Promise<any>;
}

function findCreativeRenderBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

const activeCreativeRenderWorkers = new Map<string, Promise<void>>();

async function launchCreativeRenderBrowser(): Promise<any> {
  const pw = await getPlaywrightModuleForCreativeRender();
  const executablePath = findCreativeRenderBrowserExecutable();
  try {
    return await pw.chromium.launch({
      headless: true,
      executablePath,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
  } catch {
    return pw.chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
  }
}

async function startCreativeRenderWorker(storage: ReturnType<typeof resolveCreativeStorage>, jobId: string): Promise<void> {
  const normalizedId = sanitizeCreativeRenderJobId(jobId, '');
  if (!normalizedId) throw new Error('Creative render job id is required.');
  if (activeCreativeRenderWorkers.has(normalizedId)) {
    await activeCreativeRenderWorkers.get(normalizedId);
    return;
  }
  const runPromise = (async () => {
    let browser: any = null;
    let context: any = null;
    let page: any = null;
    let cancelIssuedAt = 0;
    try {
      while (true) {
        let record = readCreativeRenderJobRecord(storage, normalizedId).record;
        if (isCreativeRenderJobTerminal(record.status)) return;
        if (record.cancelRequested) {
          record.updatedAt = new Date().toISOString();
          record.finishedAt = record.updatedAt;
          record.status = 'canceled';
          record.progressLabel = 'Canceled before server worker start';
          record.cancelRequested = false;
          record.error = null;
          broadcastCreativeRenderJobUpdate(storage, record);
          return;
        }
        if (record.preflight?.status === 'blocked') {
          record.updatedAt = new Date().toISOString();
          record.finishedAt = record.updatedAt;
          record.status = 'failed';
          record.progressLabel = record.preflight.blockers?.[0] || 'Render preflight failed';
          record.error = record.progressLabel;
          record.lastError = record.error;
          broadcastCreativeRenderJobUpdate(storage, record);
          return;
        }

        cancelIssuedAt = 0;
        record = bumpCreativeRenderJobAttempt(record as any, `worker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`) as any;
        record.updatedAt = new Date().toISOString();
        record.startedAt = record.startedAt || record.updatedAt;
        record.status = record.attemptCount > 1 ? 'retrying' : 'running';
        record.progress = creativeClampNumber(Number(record.progress) || 0, 0, 1);
        record.progressLabel = record.attemptCount > 1
          ? `Retrying headless render worker (${record.attemptCount}/${record.maxAttempts})`
          : (record.progressLabel || 'Starting headless render worker');
        record.error = null;
        broadcastCreativeRenderJobUpdate(storage, record);

        const token = resolveGatewayAuthToken();
        const baseUrl = getGatewayBaseUrl();
        const workerUrl = `${baseUrl}/api/canvas/creative-render-ui/index.html?creativeRenderWorker=1&jobId=${encodeURIComponent(record.id)}&sessionId=${encodeURIComponent(record.sessionId)}&root=${encodeURIComponent(record.storageRoot || storage.rootAbsPath)}&gatewayBaseUrl=${encodeURIComponent(baseUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

        try {
          browser = await launchCreativeRenderBrowser();
          context = await browser.newContext({
            viewport: {
              width: Math.max(960, Number(record.sceneDoc?.width) || 1280),
              height: Math.max(640, Number(record.sceneDoc?.height) || 720),
            },
          });
          page = await context.newPage();
          await page.goto(workerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

          const timeoutMs = Math.max(180000, (Number(record.exportOptions?.durationMs) || 0) * 6 + 90000);
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            await sleep(600);
            const latest = readCreativeRenderJobRecord(storage, normalizedId).record;
            if (isCreativeRenderJobTerminal(latest.status)) return;
            if (latest.cancelRequested) {
              if (!cancelIssuedAt) {
                cancelIssuedAt = Date.now();
                try {
                  await page.evaluate(() => {
                    try {
                      (globalThis as any).canvasCancelCreativeExport?.();
                    } catch {}
                  });
                } catch {}
              } else if (Date.now() - cancelIssuedAt > 6000) {
                latest.status = 'canceled';
                latest.updatedAt = new Date().toISOString();
                latest.finishedAt = latest.updatedAt;
                latest.progressLabel = 'Canceled by server worker';
                latest.error = null;
                latest.lastError = null;
                latest.cancelRequested = false;
                broadcastCreativeRenderJobUpdate(storage, latest);
                return;
              }
            }
          }
          throw new Error('Creative render worker timed out before producing a terminal result.');
        } catch (err: any) {
          const latestRecord = readCreativeRenderJobRecord(storage, normalizedId).record;
          if (isCreativeRenderJobTerminal(latestRecord.status)) return;
          let erroredRecord = appendCreativeRenderJobError(latestRecord as any, err, 'worker') as any;
          erroredRecord.updatedAt = new Date().toISOString();
          erroredRecord.error = erroredRecord.lastError;
          if (erroredRecord.cancelRequested) {
            erroredRecord.status = 'canceled';
            erroredRecord.finishedAt = erroredRecord.updatedAt;
            erroredRecord.progressLabel = 'Canceled by server worker';
            erroredRecord.cancelRequested = false;
            erroredRecord.error = null;
            broadcastCreativeRenderJobUpdate(storage, erroredRecord);
            return;
          }
          const canRetry = erroredRecord.retryable === true && erroredRecord.attemptCount < erroredRecord.maxAttempts;
          if (canRetry) {
            erroredRecord.status = 'queued';
            erroredRecord.progressLabel = `Retry scheduled after worker failure (${erroredRecord.attemptCount + 1}/${erroredRecord.maxAttempts})`;
            erroredRecord.finishedAt = null;
            broadcastCreativeRenderJobUpdate(storage, erroredRecord);
            await sleep(1200);
            continue;
          }
          erroredRecord.status = 'failed';
          erroredRecord.finishedAt = erroredRecord.updatedAt;
          erroredRecord.progressLabel = 'Server render failed';
          erroredRecord.cancelRequested = false;
          broadcastCreativeRenderJobUpdate(storage, erroredRecord);
          return;
        } finally {
          try { await page?.close(); } catch {}
          try { await context?.close(); } catch {}
          try { await browser?.close(); } catch {}
          page = null;
          context = null;
          browser = null;
        }
      }
    } finally {
      activeCreativeRenderWorkers.delete(normalizedId);
    }
  })();
  activeCreativeRenderWorkers.set(normalizedId, runPromise);
  await runPromise;
}

function broadcastCreativeRenderJobUpdate(
  storage: ReturnType<typeof resolveCreativeStorage>,
  record: CreativeRenderJobRecord,
  options: { created?: boolean; exportSaved?: boolean } = {},
): void {
  const { absPath, entry } = writeCreativeRenderJobRecord(storage, record);
  _broadcastWS({
    type: 'creative_render_job_updated',
    sessionId: record.sessionId,
    creativeMode: record.creativeMode || null,
    storageRoot: storage.rootAbsPath,
    storageRootRelative: storage.rootRelPath,
    renderJobsDir: storage.renderJobsDir,
    renderJobsDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, storage.renderJobsDir),
    jobPath: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
    jobPathRelative: buildCreativeStorageRelativePath(storage.rootAbsPath, absPath),
    created: options.created === true,
    exportSaved: options.exportSaved === true,
    terminal: isCreativeRenderJobTerminal(record.status),
    job: entry,
  });
}

type CreativeLibrarySource = 'builtin' | 'custom';
type CreativeLibrarySection = 'text' | 'shapes' | 'icons' | 'images' | 'components';
type CreativeAnimationTarget = 'text' | 'shape' | 'image' | 'icon' | 'group';

type CreativeLibraryPackCatalogEntry = {
  id: string;
  label: string;
  category: 'core' | 'icons' | 'motion' | 'components' | 'shapes';
  description: string;
  includes: string[];
  defaultEnabled: boolean;
  source?: CreativeLibrarySource;
  enabled?: boolean;
  installedAt?: string | null;
  updatedAt?: string | null;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
  sourceUrl?: string | null;
  elements?: Partial<Record<CreativeLibrarySection, any[]>>;
  animationPresets?: any[];
};

type CreativeLibraryRegistryEntry = {
  enabled: boolean;
  source: CreativeLibrarySource;
  installedAt: string;
  updatedAt: string;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
  sourceUrl?: string | null;
};

type CreativeLibraryRegistry = {
  version: number;
  updatedAt: string;
  libraries: Record<string, CreativeLibraryRegistryEntry>;
};

type CustomCreativeLibraryElementEntry = {
  kind: string;
  label: string;
  type: string;
  libraryId: string;
  meta: Record<string, any>;
  defaultWidth: number | null;
  defaultHeight: number | null;
};

type CustomCreativeAnimationPresetEntry = {
  id: string;
  label: string;
  libraryId: string;
  targets: CreativeAnimationTarget[];
  defaultDurationMs: number;
  from: Record<string, number>;
  to: Record<string, number>;
  holdMs: number;
  ease: string;
  effects: Record<string, any> | null;
};

type CustomCreativeLibraryPack = CreativeLibraryPackCatalogEntry & {
  source: 'custom';
  elements: Partial<Record<CreativeLibrarySection, CustomCreativeLibraryElementEntry[]>>;
  animationPresets: CustomCreativeAnimationPresetEntry[];
};

const CREATIVE_LIBRARY_SECTIONS: CreativeLibrarySection[] = ['text', 'shapes', 'icons', 'images', 'components'];
const CREATIVE_LIBRARY_SECTION_TYPES: Record<CreativeLibrarySection, string> = {
  text: 'text',
  shapes: 'shape',
  icons: 'icon',
  images: 'image',
  components: 'group',
};
const CREATIVE_LIBRARY_CATEGORIES = new Set(['core', 'icons', 'motion', 'components', 'shapes']);
const CREATIVE_ANIMATION_TARGETS = new Set<CreativeAnimationTarget>(['text', 'shape', 'image', 'icon', 'group']);

const BUILTIN_CREATIVE_LIBRARY_PACKS: CreativeLibraryPackCatalogEntry[] = [
  {
    id: 'core-foundation',
    label: 'Core Foundation',
    category: 'core',
    description: 'Base text, image, and shape primitives that power every scene.',
    includes: ['Text styles', 'Rect / circle / line', 'Image blocks'],
    defaultEnabled: true,
  },
  {
    id: 'iconify-essentials',
    label: 'Iconify Essentials',
    category: 'icons',
    description: 'Starter Iconify set for general UI, motion, and studio accents.',
    includes: ['Sparkles', 'Bolt', 'Lock', 'Direct icon name swaps'],
    defaultEnabled: true,
  },
  {
    id: 'motion-core',
    label: 'Motion Core',
    category: 'motion',
    description: 'Foundational motion presets for fast entrance timing.',
    includes: ['Fade In', 'Slide Up', 'Fade + Up'],
    defaultEnabled: true,
  },
  {
    id: 'components-core',
    label: 'Components Core',
    category: 'components',
    description: 'Starter components for cards, buttons, badges, and dividers.',
    includes: ['Card', 'Button', 'Badge', 'Divider'],
    defaultEnabled: true,
  },
  {
    id: 'shapes-extended',
    label: 'Shapes Extended',
    category: 'shapes',
    description: 'Adds higher-level geometry so layouts do not stop at boxes and circles.',
    includes: ['Triangle', 'Polygon'],
    defaultEnabled: false,
  },
  {
    id: 'motion-expressive',
    label: 'Motion Expressive',
    category: 'motion',
    description: 'Richer motion library for punchier entrances and text treatments.',
    includes: ['Scale Pop', 'Blur In', 'Typewriter'],
    defaultEnabled: false,
  },
  {
    id: 'iconify-ui-pack',
    label: 'Iconify UI Pack',
    category: 'icons',
    description: 'A broader UI icon starter set for product shots, marketing frames, and dashboards.',
    includes: ['Camera', 'Globe', 'Palette', 'Chart'],
    defaultEnabled: false,
  },
  {
    id: 'iconify-brand-pack',
    label: 'Iconify Brand Pack',
    category: 'icons',
    description: 'Brand icons for product mosaics, partner grids, and social compositions.',
    includes: ['GitHub', 'Figma', 'Slack'],
    defaultEnabled: false,
  },
  {
    id: 'components-story-pack',
    label: 'Components Story Pack',
    category: 'components',
    description: 'Narrative-ready blocks for quotes, stats, and presentation frames.',
    includes: ['Stat', 'Quote'],
    defaultEnabled: false,
  },
];

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneData<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeCreativeLibraryId(raw: string, fallback = ''): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function sanitizeCreativeAnimationPresetId(raw: string, fallback = ''): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function sanitizeCreativeLibraryLabel(raw: string, fallback = 'Library Pack', limit = 80): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, limit) || fallback;
}

function sanitizeCreativeLibraryDescription(raw: string, fallback = 'Imported custom creative library pack.'): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 240) || fallback;
}

function normalizeCreativeLibraryCategory(raw: string, fallback = 'components'): CreativeLibraryPackCatalogEntry['category'] {
  const normalized = String(raw || '').trim().toLowerCase();
  return CREATIVE_LIBRARY_CATEGORIES.has(normalized)
    ? normalized as CreativeLibraryPackCatalogEntry['category']
    : fallback as CreativeLibraryPackCatalogEntry['category'];
}

function normalizeCreativeLibrarySection(raw: string): CreativeLibrarySection | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'texts') return 'text';
  if (normalized === 'shape' || normalized === 'shapes') return 'shapes';
  if (normalized === 'icon' || normalized === 'icons') return 'icons';
  if (normalized === 'image' || normalized === 'images') return 'images';
  if (normalized === 'component' || normalized === 'components' || normalized === 'group' || normalized === 'groups') return 'components';
  return null;
}

function normalizeCreativeAnimationTargets(input: any): CreativeAnimationTarget[] {
  const rawValues = Array.isArray(input) ? input : [input];
  const targets = rawValues
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value): value is CreativeAnimationTarget => CREATIVE_ANIMATION_TARGETS.has(value as CreativeAnimationTarget));
  return targets.length ? [...new Set(targets)] : ['text', 'shape', 'image', 'icon', 'group'];
}

function sanitizeCreativeAnimationState(raw: any): Record<string, number> {
  const source = isPlainObject(raw) ? raw : {};
  const result: Record<string, number> = {};
  ['x', 'y', 'xOffset', 'yOffset', 'width', 'height', 'scale', 'opacity', 'rotation'].forEach((key) => {
    if (Number.isFinite(Number(source[key]))) result[key] = Number(source[key]);
  });
  return result;
}

function sanitizeCreativeMotionEffects(raw: any): Record<string, any> | null {
  const source = isPlainObject(raw) ? raw : {};
  const effects: Record<string, any> = {};
  if (isPlainObject(source.blurIn)) {
    effects.blurIn = {
      fromPx: Number.isFinite(Number(source.blurIn.fromPx)) ? Number(source.blurIn.fromPx) : 18,
      toPx: Number.isFinite(Number(source.blurIn.toPx)) ? Number(source.blurIn.toPx) : 0,
    };
  }
  if (source.typewriter) {
    const typewriter = isPlainObject(source.typewriter) ? source.typewriter : {};
    effects.typewriter = {
      sourceContent: String(typewriter.sourceContent || ''),
    };
  }
  return Object.keys(effects).length ? effects : null;
}

function normalizeCustomCreativeLibraryElement(
  section: CreativeLibrarySection,
  raw: any,
  libraryId: string,
): CustomCreativeLibraryElementEntry | null {
  if (!isPlainObject(raw)) return null;
  const kind = sanitizeCreativeLibraryId(String(raw.kind || raw.id || raw.label || '').trim(), '');
  if (!kind) return null;
  const label = sanitizeCreativeLibraryLabel(String(raw.label || raw.kind || raw.id || '').trim(), kind);
  const meta = isPlainObject(raw.meta) ? cloneData(raw.meta) : {};
  if (section === 'icons' && raw.iconName && !meta.iconName) meta.iconName = String(raw.iconName);
  if (section === 'shapes' && raw.shape && !meta.shape) meta.shape = String(raw.shape);
  if (section === 'components' && raw.component && !meta.component) meta.component = String(raw.component);
  if (section === 'text' && raw.content && !meta.content) meta.content = String(raw.content);
  if (section === 'text' && !meta.content) meta.content = label;
  return {
    kind,
    label,
    type: String(raw.type || CREATIVE_LIBRARY_SECTION_TYPES[section] || '').trim().toLowerCase() || CREATIVE_LIBRARY_SECTION_TYPES[section],
    libraryId,
    meta,
    defaultWidth: Number.isFinite(Number(raw.defaultWidth)) ? Math.max(12, Number(raw.defaultWidth)) : null,
    defaultHeight: Number.isFinite(Number(raw.defaultHeight)) ? Math.max(12, Number(raw.defaultHeight)) : null,
  };
}

function normalizeCustomCreativeAnimationPreset(raw: any, libraryId: string): CustomCreativeAnimationPresetEntry | null {
  if (!isPlainObject(raw)) return null;
  const id = sanitizeCreativeAnimationPresetId(String(raw.id || raw.label || '').trim(), '');
  if (!id) return null;
  return {
    id,
    label: sanitizeCreativeLibraryLabel(String(raw.label || raw.id || '').trim(), id),
    libraryId,
    targets: normalizeCreativeAnimationTargets(raw.targets),
    defaultDurationMs: Math.max(100, Number(raw.defaultDurationMs) || 500),
    from: sanitizeCreativeAnimationState(raw.from),
    to: sanitizeCreativeAnimationState(raw.to),
    holdMs: Math.max(0, Number(raw.holdMs) || 0),
    ease: String(raw.ease || 'power2.out').trim() || 'power2.out',
    effects: sanitizeCreativeMotionEffects(raw.effects),
  };
}

function deriveCustomCreativeLibraryCategory(
  elements: Partial<Record<CreativeLibrarySection, CustomCreativeLibraryElementEntry[]>>,
  animationPresets: CustomCreativeAnimationPresetEntry[],
  explicitCategory: string,
): CreativeLibraryPackCatalogEntry['category'] {
  const explicit = String(explicitCategory || '').trim().toLowerCase();
  if (CREATIVE_LIBRARY_CATEGORIES.has(explicit)) return explicit as CreativeLibraryPackCatalogEntry['category'];
  const hasElements = Object.values(elements).some((entries) => Array.isArray(entries) && entries.length);
  if (animationPresets.length && !hasElements) return 'motion';
  if (Array.isArray(elements.icons) && elements.icons.length) return 'icons';
  if (Array.isArray(elements.shapes) && elements.shapes.length) return 'shapes';
  if (Array.isArray(elements.components) && elements.components.length) return 'components';
  if (Array.isArray(elements.text) && elements.text.length) return 'core';
  return 'components';
}

function buildCustomCreativeLibraryIncludes(
  rawIncludes: any,
  elements: Partial<Record<CreativeLibrarySection, CustomCreativeLibraryElementEntry[]>>,
  animationPresets: CustomCreativeAnimationPresetEntry[],
): string[] {
  if (Array.isArray(rawIncludes) && rawIncludes.length) {
    return [...new Set(rawIncludes
      .map((value) => sanitizeCreativeLibraryLabel(String(value || '').trim(), '', 48))
      .filter(Boolean))].slice(0, 12);
  }
  const derived: string[] = [];
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    (Array.isArray(elements[section]) ? elements[section] : []).forEach((entry) => {
      if (entry?.label) derived.push(entry.label);
    });
  });
  animationPresets.forEach((entry) => {
    if (entry?.label) derived.push(entry.label);
  });
  return [...new Set(derived)].slice(0, 12);
}

function getCreativeLibrariesDir(storage: ReturnType<typeof resolveCreativeStorage>): string {
  const librariesDir = path.join(storage.creativeDir, 'libraries');
  fs.mkdirSync(librariesDir, { recursive: true });
  return librariesDir;
}

function getCreativeLibraryPacksDir(storage: ReturnType<typeof resolveCreativeStorage>): string {
  const packsDir = path.join(getCreativeLibrariesDir(storage), 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  return packsDir;
}

function getCreativeLibraryRegistryPath(storage: ReturnType<typeof resolveCreativeStorage>): string {
  return path.join(getCreativeLibrariesDir(storage), 'registry.json');
}

function readCreativeLibraryRegistry(storage: ReturnType<typeof resolveCreativeStorage>): CreativeLibraryRegistry {
  const registryPath = getCreativeLibraryRegistryPath(storage);
  if (!fs.existsSync(registryPath)) {
    return { version: 1, updatedAt: '', libraries: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    return {
      version: Number(parsed?.version) || 1,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
      libraries: parsed?.libraries && typeof parsed.libraries === 'object' ? parsed.libraries : {},
    };
  } catch {
    return { version: 1, updatedAt: '', libraries: {} };
  }
}

function writeCreativeLibraryRegistry(storage: ReturnType<typeof resolveCreativeStorage>, registry: CreativeLibraryRegistry): void {
  const registryPath = getCreativeLibraryRegistryPath(storage);
  const nextRegistry: CreativeLibraryRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    libraries: registry?.libraries && typeof registry.libraries === 'object' ? registry.libraries : {},
  };
  fs.writeFileSync(registryPath, JSON.stringify(nextRegistry, null, 2), 'utf-8');
}

function normalizeCustomCreativeLibraryManifest(
  raw: any,
  storage: ReturnType<typeof resolveCreativeStorage>,
  options: { sourceUrl?: string | null; manifestPath?: string; manifestPathRelative?: string; id?: string } = {},
): CustomCreativeLibraryPack {
  const source = isPlainObject(raw?.pack) ? raw.pack : raw;
  if (!isPlainObject(source)) {
    throw new Error('Creative pack manifest must be a JSON object.');
  }
  const id = sanitizeCreativeLibraryId(String(options.id || source.id || source.label || '').trim(), '');
  if (!id) {
    throw new Error('Creative pack manifest needs an id or label.');
  }
  if (BUILTIN_CREATIVE_LIBRARY_PACKS.some((pack) => pack.id === id)) {
    throw new Error(`Custom creative pack id conflicts with a built-in pack: ${id}`);
  }
  const sourceElements = isPlainObject(source.elements) ? source.elements : {};
  const elements: Partial<Record<CreativeLibrarySection, CustomCreativeLibraryElementEntry[]>> = {};
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    const rawEntries = Object.entries(sourceElements).reduce((collection: any[], [rawSection, entries]) => {
      if (normalizeCreativeLibrarySection(rawSection) !== section || !Array.isArray(entries)) return collection;
      return collection.concat(entries);
    }, []);
    const normalizedEntries = rawEntries
      .map((entry: any) => normalizeCustomCreativeLibraryElement(section, entry, id))
      .filter(Boolean) as CustomCreativeLibraryElementEntry[];
    if (normalizedEntries.length) elements[section] = normalizedEntries;
  });
  const animationPresets = (Array.isArray(source.animationPresets) ? source.animationPresets : [])
    .map((entry: any) => normalizeCustomCreativeAnimationPreset(entry, id))
    .filter(Boolean) as CustomCreativeAnimationPresetEntry[];
  if (!Object.keys(elements).length && !animationPresets.length) {
    throw new Error('Creative pack manifest must include elements or animationPresets.');
  }
  return {
    id,
    label: sanitizeCreativeLibraryLabel(String(source.label || id).trim(), id),
    category: deriveCustomCreativeLibraryCategory(elements, animationPresets, String(source.category || '').trim()),
    description: sanitizeCreativeLibraryDescription(String(source.description || '').trim()),
    includes: buildCustomCreativeLibraryIncludes(source.includes, elements, animationPresets),
    defaultEnabled: source.defaultEnabled === true,
    source: 'custom',
    sourceUrl: String(options.sourceUrl || source.sourceUrl || '').trim() || null,
    manifestPath: options.manifestPath || null,
    manifestPathRelative: options.manifestPathRelative || null,
    elements,
    animationPresets,
  };
}

function getCustomCreativeLibraryManifestFilePath(storage: ReturnType<typeof resolveCreativeStorage>, libraryId: string): string {
  return path.join(getCreativeLibraryPacksDir(storage), `${sanitizeCreativeLibraryId(libraryId)}.json`);
}

function readCustomCreativeLibraryPacks(storage: ReturnType<typeof resolveCreativeStorage>): CustomCreativeLibraryPack[] {
  const packsDir = getCreativeLibraryPacksDir(storage);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(packsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const absPath = path.join(packsDir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
        return normalizeCustomCreativeLibraryManifest(parsed, storage, {
          manifestPath: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
          manifestPathRelative: buildCreativeStorageRelativePath(storage.rootAbsPath, absPath),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CustomCreativeLibraryPack[];
}

function writeCustomCreativeLibraryPack(
  storage: ReturnType<typeof resolveCreativeStorage>,
  pack: CustomCreativeLibraryPack,
): { manifestPath: string; manifestPathRelative: string } {
  const absPath = getCustomCreativeLibraryManifestFilePath(storage, pack.id);
  const manifestPath = buildCreativeStorageRelativePath(storage.workspacePath, absPath);
  const manifestPathRelative = buildCreativeStorageRelativePath(storage.rootAbsPath, absPath);
  const persistedPack = {
    ...pack,
    manifestPath,
    manifestPathRelative,
  };
  fs.writeFileSync(absPath, JSON.stringify(persistedPack, null, 2), 'utf-8');
  return { manifestPath, manifestPathRelative };
}

function buildCreativeLibraryPayload(storage: ReturnType<typeof resolveCreativeStorage>, registry: CreativeLibraryRegistry) {
  const registryLibraries = registry?.libraries && typeof registry.libraries === 'object' ? registry.libraries : {};
  const builtinCatalog = BUILTIN_CREATIVE_LIBRARY_PACKS.map((pack) => {
    const saved = registryLibraries[pack.id];
    return {
      ...pack,
      source: 'builtin',
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : !!pack.defaultEnabled,
      installedAt: typeof saved?.installedAt === 'string' ? saved.installedAt : null,
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null,
    } as CreativeLibraryPackCatalogEntry;
  });
  const customCatalog = readCustomCreativeLibraryPacks(storage).map((pack) => {
    const saved = registryLibraries[pack.id];
    return {
      ...pack,
      source: 'custom',
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : !!pack.defaultEnabled,
      installedAt: typeof saved?.installedAt === 'string' ? saved.installedAt : null,
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null,
      manifestPath: pack.manifestPath || (typeof saved?.manifestPath === 'string' ? saved.manifestPath : null),
      manifestPathRelative: pack.manifestPathRelative || (typeof saved?.manifestPathRelative === 'string' ? saved.manifestPathRelative : null),
      sourceUrl: pack.sourceUrl || (typeof saved?.sourceUrl === 'string' ? saved.sourceUrl : null),
    } as CustomCreativeLibraryPack & CreativeLibraryPackCatalogEntry;
  });
  const libraries = [...builtinCatalog, ...customCatalog];
  return {
    registry,
    librariesDir: getCreativeLibrariesDir(storage),
    librariesDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, getCreativeLibrariesDir(storage)),
    builtinCatalog,
    customCatalog,
    libraries,
    enabledLibraryIds: libraries.filter((entry) => entry.enabled).map((entry) => entry.id),
  };
}

async function resolveCreativeLibraryImportManifest(input: any): Promise<{ manifest: any; sourceUrl: string | null }> {
  const sourceUrl = String(input?.sourceUrl || input?.url || '').trim();
  if (sourceUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      throw new Error('Creative pack URL must be a valid absolute URL.');
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      throw new Error('Creative pack URL must use http or https.');
    }
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Could not download creative pack manifest (${response.status}).`);
    }
    try {
      return {
        manifest: JSON.parse(body),
        sourceUrl: parsedUrl.toString(),
      };
    } catch {
      throw new Error('Creative pack URL did not return valid JSON.');
    }
  }

  if (isPlainObject(input?.manifest)) {
    return {
      manifest: input.manifest,
      sourceUrl: String(input?.manifest?.sourceUrl || '').trim() || null,
    };
  }

  const manifestText = String(input?.manifestText || input?.manifestJson || '').trim();
  if (manifestText) {
    try {
      return {
        manifest: JSON.parse(manifestText),
        sourceUrl: null,
      };
    } catch {
      throw new Error('Creative pack JSON could not be parsed.');
    }
  }

  throw new Error('Provide creative pack JSON, a manifest object, or a manifest URL.');
}

function summarizeCreativeSceneDoc(doc: any): any {
  const elements = Array.isArray(doc?.elements) ? doc.elements : [];
  return {
    width: Number.isFinite(Number(doc?.width)) ? Number(doc.width) : null,
    height: Number.isFinite(Number(doc?.height)) ? Number(doc.height) : null,
    background: typeof doc?.background === 'string' ? doc.background : null,
    durationMs: Number.isFinite(Number(doc?.durationMs)) ? Number(doc.durationMs) : null,
    frameRate: Number.isFinite(Number(doc?.frameRate)) ? Number(doc.frameRate) : null,
    elementCount: elements.length,
    textCount: elements.filter((element: any) => element?.type === 'text').length,
    imageCount: elements.filter((element: any) => element?.type === 'image').length,
    iconCount: elements.filter((element: any) => element?.type === 'icon').length,
    groupCount: elements.filter((element: any) => element?.type === 'group').length,
    animatedCount: elements.filter((element: any) => Array.isArray(element?.meta?.keyframes) && element.meta.keyframes.length > 0).length,
  };
}

function collectCreativeAssetEntries(
  directoryPath: string,
  workspacePath: string,
  rootAbsPath: string,
  kind: 'scene' | 'export',
): any[] {
  const results: any[] = [];
  const visit = (currentPath: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
    for (const entry of sorted) {
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(absPath);
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue;
      }
      const item: any = {
        kind,
        name: entry.name,
        ext: path.extname(entry.name).toLowerCase(),
        path: buildCreativeStorageRelativePath(workspacePath, absPath),
        relativePath: buildCreativeStorageRelativePath(rootAbsPath, absPath),
        absPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
      if (kind === 'scene') {
        try {
          const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
          const doc = parsed?.kind === 'prometheus-creative-scene' && parsed?.doc ? parsed.doc : parsed;
          item.savedAt = parsed?.savedAt || item.modifiedAt;
          item.creativeMode = typeof parsed?.creativeMode === 'string' ? parsed.creativeMode : null;
          item.summary = parsed?.summary || summarizeCreativeSceneDoc(doc);
        } catch (err: any) {
          item.parseError = String(err?.message || 'Could not parse scene metadata');
        }
      } else {
        item.mimeType = String(guessContentType(absPath) || 'application/octet-stream').split(';')[0].trim();
      }
      results.push(item);
    }
  };
  visit(directoryPath);
  return results.sort((left, right) => {
    const leftTime = Date.parse(String(left?.savedAt || left?.modifiedAt || '')) || 0;
    const rightTime = Date.parse(String(right?.savedAt || right?.modifiedAt || '')) || 0;
    return rightTime - leftTime;
  });
}

function writeCreativeExportArtifact(
  storage: ReturnType<typeof resolveCreativeStorage>,
  options: {
    rawBase64?: string;
    buffer?: Buffer;
    mimeType: string;
    filename?: string;
    relativePath?: string;
  },
): {
  filename: string;
  path: string;
  absPath: string;
  mimeType: string;
  size: number;
} {
  const mimeType = String(options?.mimeType || 'application/octet-stream').trim();
  const fallbackName = `creative-export${extensionForMimeType(mimeType) || '.bin'}`;
  const filename = sanitizeCreativeAssetFilename(options?.filename, fallbackName);
  const relativePath = sanitizeRelativeUploadPath(String(options?.relativePath || '').trim());
  let targetPath = relativePath
    ? path.resolve(storage.exportsDir, relativePath)
    : path.join(storage.exportsDir, filename);
  if (!path.extname(targetPath) && extensionForMimeType(mimeType)) {
    targetPath = `${targetPath}${extensionForMimeType(mimeType)}`;
  }
  if (!isPathInside(storage.exportsDir, targetPath)) {
    throw new Error('relativePath must stay within the creative exports directory');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const buffer = Buffer.isBuffer(options?.buffer)
    ? options.buffer
    : Buffer.from(String(options?.rawBase64 || '').replace(/^data:.*?;base64,/, ''), 'base64');
  fs.writeFileSync(targetPath, buffer);
  const relPath = buildCreativeStorageRelativePath(storage.workspacePath, targetPath);
  const stat = fs.statSync(targetPath);
  return {
    filename: path.basename(targetPath),
    path: relPath,
    absPath: targetPath,
    mimeType,
    size: stat.size,
  };
}

let creativeFfmpegAvailabilityPromise: Promise<boolean> | null = null;

async function hasCreativeFfmpeg(): Promise<boolean> {
  if (!creativeFfmpegAvailabilityPromise) {
    creativeFfmpegAvailabilityPromise = (async () => {
      try {
        await execFileAsync('ffmpeg', ['-version'], {
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        return true;
      } catch {
        return false;
      }
    })();
  }
  return creativeFfmpegAvailabilityPromise;
}

function sanitizeHtmlMotionFilename(raw: string | undefined, fallback = 'html-motion-clip.html'): string {
  const cleaned = sanitizeCreativeAssetFilename(raw, fallback);
  return cleaned.toLowerCase().endsWith('.html') || cleaned.toLowerCase().endsWith('.htm')
    ? cleaned
    : `${cleaned.replace(/\.[^.]+$/i, '') || 'html-motion-clip'}.html`;
}

function getHtmlMotionDir(storage: ReturnType<typeof resolveCreativeStorage>): string {
  const dir = path.join(storage.creativeDir, 'html-motion');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildHtmlMotionClipEntry(
  storage: ReturnType<typeof resolveCreativeStorage>,
  htmlPath: string,
  manifestPath: string,
  manifest: any,
): any {
  const stat = fs.statSync(htmlPath);
  return {
    kind: 'html_motion_clip',
    id: manifest.id,
    title: manifest.title || path.basename(htmlPath),
    filename: path.basename(htmlPath),
    path: buildCreativeStorageRelativePath(storage.workspacePath, htmlPath),
    absPath: htmlPath,
    manifestPath: buildCreativeStorageRelativePath(storage.workspacePath, manifestPath),
    manifestAbsPath: manifestPath,
    width: Number(manifest.width) || 1080,
    height: Number(manifest.height) || 1920,
    durationMs: Math.max(1000, Number(manifest.durationMs) || 8000),
    frameRate: Math.max(1, Number(manifest.frameRate) || 60),
    assets: Array.isArray(manifest.assets)
      ? manifest.assets.map((asset: any) => ({
          id: asset.id,
          type: asset.type || 'asset',
          source: asset.source || asset.path || asset.url || '',
          path: asset.path || null,
          url: asset.url || null,
          mimeType: asset.mimeType || null,
          filename: asset.filename || null,
        }))
      : [],
    composition: manifest.composition || null,
    lint: manifest.lint || null,
    template: manifest.template || null,
    templateId: manifest.templateId || manifest.template?.id || null,
    parameters: Array.isArray(manifest.parameters) ? manifest.parameters : [],
    parameterValues: manifest.parameterValues && typeof manifest.parameterValues === 'object' ? manifest.parameterValues : {},
    createdAt: manifest.createdAt || stat.birthtime.toISOString(),
    updatedAt: manifest.updatedAt || stat.mtime.toISOString(),
    storageRoot: storage.rootAbsPath,
    storageRootRelative: storage.rootRelPath,
    usesProjectRoot: storage.usesProjectRoot,
  };
}

function readHtmlMotionManifest(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string): { manifestPath: string; manifest: any } {
  const dir = getHtmlMotionDir(storage);
  const manifestPath = path.join(dir, `${path.basename(htmlPath).replace(/\.[^.]+$/i, '')}.json`);
  let manifest: any = {};
  if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      manifest = {};
    }
  }
  return { manifestPath, manifest };
}

function resolveHtmlMotionClipFile(storage: ReturnType<typeof resolveCreativeStorage>, rawPath: string): { absPath: string; relPath: string } {
  const { absPath, relPath } = resolveCanvasPath(String(rawPath || '').trim());
  const htmlDir = getHtmlMotionDir(storage);
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') throw new Error('HTML motion clip path must point to an .html file.');
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) throw new Error('HTML motion clip not found.');
  if (!isPathInside(htmlDir, absPath) && !isPathInside(storage.rootAbsPath, absPath)) {
    throw new Error('HTML motion clip must stay inside the creative workspace.');
  }
  return { absPath, relPath };
}

function sanitizeHtmlMotionAssetId(raw: any, fallback = ''): string {
  return String(raw || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeHtmlMotionAssetType(raw: any, source = ''): string {
  const explicit = String(raw || '').trim().toLowerCase();
  if (['image', 'video', 'audio', 'font', 'asset'].includes(explicit)) return explicit;
  const mime = String(guessContentType(source) || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (/\.woff2?$|\.ttf$|\.otf$/i.test(String(source || ''))) return 'font';
  return 'asset';
}

function normalizeHtmlMotionClipAssets(storage: ReturnType<typeof resolveCreativeStorage>, rawAssets: any[]): any[] {
  const results: any[] = [];
  const seen = new Set<string>();
  const assets = Array.isArray(rawAssets) ? rawAssets : [];
  assets.forEach((rawAsset, index) => {
    if (!rawAsset || typeof rawAsset !== 'object') return;
    const id = sanitizeHtmlMotionAssetId(rawAsset.id || rawAsset.name || `asset-${index + 1}`);
    const source = String(rawAsset.source || rawAsset.path || rawAsset.url || rawAsset.href || '').trim();
    if (!id || !source || seen.has(id)) return;
    seen.add(id);
    const base = {
      id,
      label: String(rawAsset.label || rawAsset.name || id).trim() || id,
      source,
      type: normalizeHtmlMotionAssetType(rawAsset.type, source),
      mimeType: String(rawAsset.mimeType || '').trim() || null,
      filename: '',
      path: null as string | null,
      absPath: null as string | null,
      url: null as string | null,
      dataUrl: null as string | null,
    };
    if (/^data:/i.test(source)) {
      const mimeMatch = source.match(/^data:([^;,]+)/i);
      results.push({
        ...base,
        dataUrl: source,
        mimeType: base.mimeType || mimeMatch?.[1] || 'application/octet-stream',
      });
      return;
    }
    if (/^https?:\/\//i.test(source)) {
      results.push({
        ...base,
        url: source,
        mimeType: base.mimeType || guessContentType(source),
      });
      return;
    }
    const { absPath } = resolveCanvasPath(source);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`HTML motion asset not found: ${source}`);
    }
    results.push({
      ...base,
      path: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
      absPath,
      filename: path.basename(absPath),
      mimeType: base.mimeType || guessContentType(absPath),
      type: normalizeHtmlMotionAssetType(rawAsset.type, absPath),
    });
  });
  return results;
}

function normalizeHtmlMotionManifestAssets(storage: ReturnType<typeof resolveCreativeStorage>, manifest: any): any {
  if (!manifest || typeof manifest !== 'object') return manifest;
  if (!Array.isArray(manifest.assets)) return manifest;
  return {
    ...manifest,
    assets: normalizeHtmlMotionClipAssets(storage, manifest.assets),
  };
}

function resolveHtmlMotionAssetAbsPath(storage: ReturnType<typeof resolveCreativeStorage>, asset: any): string | null {
  for (const candidate of [asset?.absPath, asset?.path, asset?.source]) {
    const raw = String(candidate || '').trim();
    if (!raw || /^https?:\/\//i.test(raw) || /^data:/i.test(raw)) continue;
    try {
      const { absPath } = resolveCanvasPath(raw);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile() && isPathInside(storage.workspacePath, absPath)) {
        return absPath;
      }
    } catch {}
  }
  return null;
}

function resolveHtmlMotionAudioAttachment(
  storage: ReturnType<typeof resolveCreativeStorage>,
  manifest: any,
  body: any,
): { sourcePath: string; trimStartMs: number; label: string } | null {
  const requestedAssetId = sanitizeHtmlMotionAssetId(body?.audioAssetId || body?.audio?.assetId || body?.audio?.id || '');
  const explicitSource = String(body?.audioSource || body?.backgroundMusic || body?.narration || body?.audio?.source || '').trim();
  const trimStartMs = Math.max(0, Math.round(Number(body?.audioTrimStartMs ?? body?.audio?.trimStartMs ?? 0) || 0));
  if (requestedAssetId && Array.isArray(manifest?.assets)) {
    const asset = manifest.assets.find((candidate: any) => sanitizeHtmlMotionAssetId(candidate?.id || '') === requestedAssetId);
    const sourcePath = asset ? resolveHtmlMotionAssetAbsPath(storage, asset) : null;
    if (sourcePath) return { sourcePath, trimStartMs, label: requestedAssetId };
  }
  if (explicitSource) {
    const { absPath } = resolveCanvasPath(explicitSource);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`HTML motion audio source not found: ${explicitSource}`);
    }
    if (!isPathInside(storage.workspacePath, absPath)) {
      throw new Error('HTML motion audio source must stay inside the workspace.');
    }
    return { sourcePath: absPath, trimStartMs, label: path.basename(absPath) };
  }
  if (body?.includeAudio === true && Array.isArray(manifest?.assets)) {
    const asset = manifest.assets.find((candidate: any) => String(candidate?.type || '').toLowerCase() === 'audio');
    const sourcePath = asset ? resolveHtmlMotionAssetAbsPath(storage, asset) : null;
    if (sourcePath) return { sourcePath, trimStartMs, label: sanitizeHtmlMotionAssetId(asset?.id || path.basename(sourcePath)) };
  }
  return null;
}

function getHtmlMotionAssetPublicUrl(asset: any, options: { sessionId: string; htmlPath: string; root?: string; absolute?: boolean }): string {
  if (asset?.dataUrl) return String(asset.dataUrl);
  if (asset?.url) return String(asset.url);
  const params = new URLSearchParams({
    sessionId: options.sessionId || 'default',
    path: String(options.htmlPath || ''),
    asset: String(asset?.id || ''),
  });
  if (options.root) params.set('root', options.root);
  const token = resolveGatewayAuthToken();
  if (token) params.set('token', token);
  const url = `/api/canvas/html-motion-clip/asset?${params.toString()}`;
  return options.absolute ? `${getGatewayBaseUrl()}${url}` : url;
}

const HTML_MOTION_FLOW_RUNTIME = String.raw`
<style id="prometheus-html-motion-flow-runtime-style">
.prometheus-html-motion-flow-spacer{display:block!important;pointer-events:none!important;user-select:none!important;color:transparent!important;overflow:hidden!important}
[data-prometheus-html-motion-flow-active="true"]{text-wrap:pretty}
[data-prometheus-html-motion-flow-detached="true"]{float:none!important;shape-outside:none!important;margin:0!important}
</style>
<script id="prometheus-html-motion-flow-runtime">
(function(){
  if (window.__PROMETHEUS_HTML_MOTION_FLOW_RUNTIME__) return;
  window.__PROMETHEUS_HTML_MOTION_FLOW_RUNTIME__ = true;
  var FLOW_MARGIN = 18;
  var FLOW_EXCLUSION_SELECTOR = '[data-flow-exclusion],[data-layout-exclusion],[data-role="flow-exclusion"],[data-role="exclusion"],[data-role="orb"],.flow-exclusion,.orb';
  var FLOW_TEXT_SELECTOR = '[data-flow-text],[data-role="flow-text"],[data-role="article-text"],[data-role="body-copy"],.flow-text,.article-copy';
  var flowScheduled = false;
  function qsa(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function isVisible(el){
    if (!el || !el.getBoundingClientRect) return false;
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }
  function selectorFor(el){
    if (!el) return '';
    if (el.id) return '#' + el.id;
    var role = el.getAttribute && el.getAttribute('data-role');
    if (role) return '[data-role="' + String(role).replace(/"/g, '\\"') + '"]';
    var cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0,2).join('.');
    return cls ? el.tagName.toLowerCase() + '.' + cls : el.tagName.toLowerCase();
  }
  function inflate(rect, halo){
    return { left: rect.left - halo, top: rect.top - halo, right: rect.right + halo, bottom: rect.bottom + halo, width: rect.width + halo * 2, height: rect.height + halo * 2 };
  }
  function overlap(a,b){
    var x = Math.min(a.right,b.right) - Math.max(a.left,b.left);
    var y = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
    return x > 0 && y > 0 ? { x:x, y:y, area:x*y } : null;
  }
  function flowShape(el){
    var explicit = String((el.getAttribute && (el.getAttribute('data-flow-shape') || el.getAttribute('data-layout-shape'))) || '').toLowerCase();
    if (explicit) return explicit;
    var radius = String(getComputedStyle(el).borderRadius || '').toLowerCase();
    if ((el.classList && el.classList.contains('orb')) || radius.indexOf('50%') >= 0 || radius.indexOf('999') >= 0) return 'circle';
    return 'rect';
  }
  function removeSpacers(){
    qsa('.prometheus-html-motion-flow-spacer').forEach(function(node){ node.remove(); });
    qsa('[data-prometheus-html-motion-flow-active="true"]').forEach(function(node){ node.removeAttribute('data-prometheus-html-motion-flow-active'); });
  }
  function exclusions(){
    return qsa(FLOW_EXCLUSION_SELECTOR).filter(isVisible);
  }
  function textTargets(){
    return qsa(FLOW_TEXT_SELECTOR).filter(isVisible);
  }
  function closestFlowText(el){
    return el && el.closest ? el.closest(FLOW_TEXT_SELECTOR) : null;
  }
  function closestFlowExclusion(el){
    return el && el.closest ? el.closest(FLOW_EXCLUSION_SELECTOR) : null;
  }
  function detachNestedExclusions(){
    exclusions().forEach(function(el){
      if (el.getAttribute('data-prometheus-html-motion-flow-detached') === 'true') return;
      var textEl = closestFlowText(el);
      if (!textEl || !textEl.contains(el)) return;
      var rect = el.getBoundingClientRect();
      var textRect = textEl.getBoundingClientRect();
      if (!rect.width || !rect.height || !textRect.width || !textRect.height) return;
      var textStyle = getComputedStyle(textEl);
      if (textStyle.position === 'static') textEl.style.position = 'relative';
      el.style.position = 'absolute';
      el.style.left = Math.round(rect.left - textRect.left) + 'px';
      el.style.top = Math.round(rect.top - textRect.top) + 'px';
      el.style.width = Math.round(rect.width) + 'px';
      el.style.height = Math.round(rect.height) + 'px';
      el.style.float = 'none';
      el.style.margin = '0';
      el.style.shapeOutside = 'none';
      el.style.zIndex = el.style.zIndex || '8';
      el.setAttribute('data-prometheus-html-motion-flow-detached','true');
    });
  }
  function applyOne(textEl, exEl){
    var textRect = textEl.getBoundingClientRect();
    var exRect = exEl.getBoundingClientRect();
    var expanded = inflate(exRect, FLOW_MARGIN);
    var ov = overlap(textRect, expanded);
    if (!ov) return false;
    var side = (exRect.left + exRect.width / 2) < (textRect.left + textRect.width / 2) ? 'left' : 'right';
    var overlapTop = Math.max(0, Math.round(expanded.top - textRect.top));
    var overlapHeight = Math.max(16, Math.round(Math.min(textRect.bottom, expanded.bottom) - Math.max(textRect.top, expanded.top)));
    var intrusion = side === 'left' ? Math.max(0, Math.round(expanded.right - textRect.left)) : Math.max(0, Math.round(textRect.right - expanded.left));
    var spacerWidth = Math.min(Math.max(24, intrusion), Math.max(24, Math.round(textRect.width * 0.82)));
    var spacer = document.createElement('span');
    var shape = flowShape(exEl);
    spacer.className = 'prometheus-html-motion-flow-spacer';
    spacer.setAttribute('aria-hidden','true');
    spacer.dataset.prometheusFlowSource = selectorFor(exEl);
    spacer.style.cssText = [
      'float:' + side,
      'width:' + spacerWidth + 'px',
      'height:' + overlapHeight + 'px',
      'margin-' + (side === 'left' ? 'right' : 'left') + ':' + FLOW_MARGIN + 'px',
      'margin-top:' + overlapTop + 'px',
      shape === 'circle' ? 'shape-outside:circle(50%)' : 'shape-outside:inset(0 round 12px)',
      shape === 'circle' ? 'clip-path:circle(50%)' : ''
    ].filter(Boolean).join(';');
    textEl.insertBefore(spacer, textEl.firstChild);
    textEl.setAttribute('data-prometheus-html-motion-flow-active','true');
    return true;
  }
  function applyFlow(){
    try {
    removeSpacers();
    detachNestedExclusions();
    var ex = exclusions();
    textTargets().forEach(function(textEl){
      var textRect = textEl.getBoundingClientRect();
      var matches = [];
      ex.forEach(function(exEl){
        var rect = exEl.getBoundingClientRect();
        var expanded = inflate(rect, FLOW_MARGIN);
        var ov = overlap(textRect, expanded);
        if (ov) matches.push({ el: exEl, rect: rect, expanded: expanded, area: ov.area });
      });
      matches.sort(function(a,b){
        var topDelta = a.expanded.top - b.expanded.top;
        if (Math.abs(topDelta) > 8) return topDelta;
        return b.area - a.area;
      }).slice(0,4).forEach(function(match){ applyOne(textEl, match.el); });
    });
    } catch {}
  }
  function scheduleFlow(){
    if (flowScheduled) return;
    flowScheduled = true;
    requestAnimationFrame(function(){
      flowScheduled = false;
      applyFlow();
    });
  }
  window.__PROMETHEUS_APPLY_HTML_MOTION_FLOW__ = applyFlow;
  window.__PROMETHEUS_SCHEDULE_HTML_MOTION_FLOW__ = scheduleFlow;
  try {
    var observer = new MutationObserver(function(records){
      for (var i = 0; i < records.length; i += 1) {
        var target = records[i].target;
        if (closestFlowExclusion(target) || closestFlowText(target)) {
          scheduleFlow();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { subtree:true, attributes:true, attributeFilter:['style','class','data-drag-x','data-drag-y','data-dragX','data-dragY','data-flow-shape','data-layout-shape'] });
  } catch {}
  window.addEventListener('prometheus-html-motion-seek', function(){ requestAnimationFrame(function(){ requestAnimationFrame(applyFlow); }); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyFlow, { once:true });
  else requestAnimationFrame(applyFlow);
})();
</script>`;

function injectHtmlMotionFlowRuntime(html: string): string {
  const source = String(html || '');
  if (/__PROMETHEUS_HTML_MOTION_FLOW_RUNTIME__/i.test(source)) return source;
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${HTML_MOTION_FLOW_RUNTIME}</head>`);
  if (/<\/body>/i.test(source)) return source.replace(/<\/body>/i, `${HTML_MOTION_FLOW_RUNTIME}</body>`);
  return `${source}${HTML_MOTION_FLOW_RUNTIME}`;
}

function renderHtmlMotionClipHtml(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string, manifest: any, options: { sessionId: string; root?: string; absoluteUrls?: boolean }): string {
  let html = fs.readFileSync(htmlPath, 'utf-8');
  const htmlRelPath = buildCreativeStorageRelativePath(storage.workspacePath, htmlPath);
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  assets.forEach((asset: any) => {
    const id = sanitizeHtmlMotionAssetId(asset?.id || '');
    if (!id) return;
    const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const url = getHtmlMotionAssetPublicUrl(asset, {
      sessionId: options.sessionId,
      htmlPath: htmlRelPath,
      root: options.root,
      absolute: options.absoluteUrls === true,
    });
    const escaped = url.replace(/\\/g, '/');
    html = html
      .replace(new RegExp(`\\{\\{\\s*asset\\.${escapedId}\\s*\\}\\}`, 'gi'), escaped)
      .replace(new RegExp(`\\{\\{\\s*${escapedId}\\s*\\}\\}`, 'gi'), escaped)
      .replace(new RegExp(`__PROM_ASSET_${escapedId.toUpperCase()}__`, 'g'), escaped);
  });
  const assetMapJson = JSON.stringify(Object.fromEntries(assets.map((asset: any) => [
    asset.id,
    getHtmlMotionAssetPublicUrl(asset, {
      sessionId: options.sessionId,
      htmlPath: htmlRelPath,
      root: options.root,
      absolute: options.absoluteUrls === true,
    }),
  ]))).replace(/</g, '\\u003c');
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `<script>window.PROMETHEUS_HTML_MOTION_ASSETS=${assetMapJson};</script></head>`);
  }
  html = injectHtmlMotionFlowRuntime(html);
  return html;
}

function writeStandaloneHtmlMotionExport(options: {
  storage: ReturnType<typeof resolveCreativeStorage>;
  htmlPath: string;
  manifest: any;
  outputDir: string;
}): { folder: string; files: Array<{ path: string; absPath: string }>; manifest: any } {
  const { storage, htmlPath, manifest, outputDir } = options;
  const resolvedOutputDir = path.resolve(outputDir);
  if (!isPathInside(storage.exportsDir, resolvedOutputDir) && !isPathInside(storage.rootAbsPath, resolvedOutputDir)) {
    throw new Error('Standalone HTML Motion export folder must stay inside the creative workspace.');
  }
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const assetsDir = path.join(resolvedOutputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  let html = fs.readFileSync(htmlPath, 'utf-8');
  const exportedAssets: any[] = [];
  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    const id = sanitizeHtmlMotionAssetId(asset?.id || '');
    if (!id) continue;
    let relativeAssetPath = '';
    if (asset?.dataUrl) {
      const mime = String(asset.mimeType || '').trim() || 'application/octet-stream';
      const ext = mime.includes('/') ? `.${mime.split('/')[1].replace(/[^a-z0-9]+/gi, '') || 'bin'}` : '.bin';
      const target = path.join(assetsDir, `${id}${ext}`);
      const payload = String(asset.dataUrl).replace(/^data:.*?;base64,/, '');
      fs.writeFileSync(target, Buffer.from(payload, 'base64'));
      relativeAssetPath = `assets/${path.basename(target)}`;
    } else {
      const sourcePath = resolveHtmlMotionAssetAbsPath(storage, asset);
      if (!sourcePath) continue;
      const ext = path.extname(sourcePath) || '';
      const safeName = sanitizeCreativeAssetFilename(asset.filename || `${id}${ext}`, `${id}${ext || '.asset'}`);
      const target = path.join(assetsDir, safeName);
      fs.copyFileSync(sourcePath, target);
      relativeAssetPath = `assets/${safeName}`;
    }
    html = html.replace(new RegExp(`\\{\\{\\s*asset\\.${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}\\}`, 'gi'), relativeAssetPath);
    exportedAssets.push({
      id,
      type: asset.type || 'asset',
      path: relativeAssetPath,
      mimeType: asset.mimeType || null,
    });
  }
  const lint = lintHtmlMotionComposition(html, {
    ...manifest,
    assets: exportedAssets,
  });
  const standaloneManifest = {
    kind: 'prometheus-html-motion-standalone-export',
    version: 1,
    source: {
      htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, htmlPath),
      id: manifest.id || null,
      title: manifest.title || path.basename(htmlPath),
    },
    renderer: 'html-motion',
    compatibility: {
      target: 'prometheus-html-motion',
      hyperframesStyle: true,
      notes: 'Self-contained Prometheus HTML Motion folder with HyperFrames-style metadata.',
    },
    width: Number(manifest.width) || lint.composition.width || 1080,
    height: Number(manifest.height) || lint.composition.height || 1920,
    durationMs: Number(manifest.durationMs) || lint.composition.durationMs || 8000,
    frameRate: Number(manifest.frameRate) || lint.composition.frameRate || 30,
    assets: exportedAssets,
    lint,
    exportedAt: new Date().toISOString(),
  };
  const indexPath = path.join(resolvedOutputDir, 'index.html');
  const manifestPath = path.join(resolvedOutputDir, 'manifest.json');
  const readmePath = path.join(resolvedOutputDir, 'README.md');
  fs.writeFileSync(indexPath, html, 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify(standaloneManifest, null, 2), 'utf-8');
  fs.writeFileSync(readmePath, [
    '# Prometheus HTML Motion Standalone Export',
    '',
    'Open `index.html` in Prometheus or a browser-capable agent runtime.',
    '',
    'This folder is Prometheus-native HTML Motion with HyperFrames-style metadata. It does not require the HyperFrames runtime.',
    '',
    '- `index.html`: composition source',
    '- `assets/`: local media assets',
    '- `manifest.json`: dimensions, duration, frame rate, assets, and lint summary',
  ].join('\n'), 'utf-8');
  const files = [indexPath, manifestPath, readmePath, ...exportedAssets.map((asset) => path.join(resolvedOutputDir, asset.path))].map((absPath) => ({
    path: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
    absPath,
  }));
  return { folder: resolvedOutputDir, files, manifest: standaloneManifest };
}

function escapeHtmlMotionRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getHtmlMotionRevisionDir(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string): string {
  const clipId = path.basename(htmlPath).replace(/\.[^.]+$/i, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 96) || 'clip';
  const dir = path.join(getHtmlMotionDir(storage), 'revisions', clipId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildHtmlMotionSourceOutline(html: string): any {
  const ids = Array.from(html.matchAll(/\bid=["']([^"']+)["']/gi)).map((match) => match[1]).slice(0, 80);
  const classes = Array.from(html.matchAll(/\bclass=["']([^"']+)["']/gi))
    .flatMap((match) => String(match[1] || '').split(/\s+/).filter(Boolean))
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 120);
  const cssVars = Array.from(html.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}{]+);/gi))
    .map((match) => ({ name: match[1], value: String(match[2] || '').trim() }))
    .slice(0, 120);
  const keyframes = Array.from(html.matchAll(/@keyframes\s+([a-z0-9_-]+)/gi)).map((match) => match[1]).slice(0, 80);
  const regions = Array.from(html.matchAll(/<!--\s*@prometheus-region\s+([a-z0-9_-]+)\s*-->/gi)).map((match) => match[1]).slice(0, 80);
  const assetPlaceholders = [
    ...Array.from(html.matchAll(/\{\{\s*asset\.([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
    ...Array.from(html.matchAll(/\{\{\s*(?!asset\.)([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
    ...Array.from(html.matchAll(/__PROM_ASSET_([A-Z0-9_-]+)__/g)).map((match) => match[1].toLowerCase()),
  ].filter((value, index, list) => value && list.indexOf(value) === index).slice(0, 80);
  return {
    ids,
    classes,
    cssVars,
    keyframes,
    regions,
    assetPlaceholders,
    counts: {
      ids: ids.length,
      classes: classes.length,
      cssVars: cssVars.length,
      keyframes: keyframes.length,
      regions: regions.length,
      assetPlaceholders: assetPlaceholders.length,
    },
  };
}

function buildHtmlMotionSourcePayload(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string, manifestPath: string, manifest: any, options: { includeHtml?: boolean } = {}): any {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const metadata = buildHtmlMotionCompositionMetadata(html, manifest);
  return {
    clip: buildHtmlMotionClipEntry(storage, htmlPath, manifestPath, manifest),
    html: options.includeHtml === false ? undefined : html,
    htmlLength: html.length,
    manifest,
    outline: buildHtmlMotionSourceOutline(html),
    composition: metadata.composition,
    lint: metadata.lint,
  };
}

function saveHtmlMotionRevision(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string, manifestPath: string, reason = ''): any {
  const revisionDir = getHtmlMotionRevisionDir(storage, htmlPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}_${Math.random().toString(36).slice(2, 7)}`;
  const htmlRevisionPath = path.join(revisionDir, `${base}.html`);
  const manifestRevisionPath = path.join(revisionDir, `${base}.json`);
  fs.copyFileSync(htmlPath, htmlRevisionPath);
  if (fs.existsSync(manifestPath)) {
    fs.copyFileSync(manifestPath, manifestRevisionPath);
  } else {
    fs.writeFileSync(manifestRevisionPath, JSON.stringify({ reason, createdAt: new Date().toISOString() }, null, 2), 'utf-8');
  }
  return {
    id: base,
    reason,
    htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, htmlRevisionPath),
    manifestPath: buildCreativeStorageRelativePath(storage.workspacePath, manifestRevisionPath),
    createdAt: new Date().toISOString(),
  };
}

function listHtmlMotionRevisions(storage: ReturnType<typeof resolveCreativeStorage>, htmlPath: string): any[] {
  const revisionDir = getHtmlMotionRevisionDir(storage, htmlPath);
  if (!fs.existsSync(revisionDir)) return [];
  return fs.readdirSync(revisionDir)
    .filter((filename) => /\.html$/i.test(filename))
    .map((filename) => {
      const htmlRevisionPath = path.join(revisionDir, filename);
      const stat = fs.statSync(htmlRevisionPath);
      const id = filename.replace(/\.html$/i, '');
      const manifestRevisionPath = path.join(revisionDir, `${id}.json`);
      return {
        id,
        htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, htmlRevisionPath),
        manifestPath: fs.existsSync(manifestRevisionPath) ? buildCreativeStorageRelativePath(storage.workspacePath, manifestRevisionPath) : null,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100);
}

function replaceHtmlMotionOccurrence(source: string, find: string, replacement: string, occurrence: number | string | undefined): { next: string; count: number } {
  if (!find) throw new Error('replace_text requires find.');
  if (occurrence === 'all') {
    const parts = source.split(find);
    return { next: parts.join(replacement), count: Math.max(0, parts.length - 1) };
  }
  const targetOccurrence = Math.max(1, Math.round(Number(occurrence) || 1));
  let cursor = 0;
  let count = 0;
  while (true) {
    const index = source.indexOf(find, cursor);
    if (index < 0) break;
    count += 1;
    if (count === targetOccurrence) {
      return {
        next: `${source.slice(0, index)}${replacement}${source.slice(index + find.length)}`,
        count: 1,
      };
    }
    cursor = index + find.length;
  }
  return { next: source, count: 0 };
}

function applyHtmlMotionPatchOperations(
  storage: ReturnType<typeof resolveCreativeStorage>,
  sourceHtml: string,
  sourceManifest: any,
  rawOps: any[],
): { html: string; manifest: any; applied: any[] } {
  let html = sourceHtml;
  const manifest = creativeCloneData(sourceManifest || {});
  const applied: any[] = [];
  const ops = Array.isArray(rawOps) ? rawOps : [];
  if (!ops.length) throw new Error('patch requires at least one operation.');
  ops.forEach((rawOp, index) => {
    const op = rawOp && typeof rawOp === 'object' ? rawOp : {};
    const opName = String(op.op || op.type || '').trim();
    if (!opName) throw new Error(`patch operation ${index + 1} is missing op.`);
    if (opName === 'replace_text') {
      const result = replaceHtmlMotionOccurrence(html, String(op.find || ''), String(op.replace ?? op.replacement ?? ''), op.occurrence);
      if (!result.count && op.required !== false) throw new Error(`replace_text did not find target: ${String(op.find || '').slice(0, 80)}`);
      html = result.next;
      applied.push({ op: opName, count: result.count });
      return;
    }
    if (opName === 'replace_between') {
      const start = String(op.start || '').trim();
      const end = String(op.end || '').trim();
      if (!start || !end) throw new Error('replace_between requires start and end markers.');
      const startIndex = html.indexOf(start);
      const endIndex = startIndex >= 0 ? html.indexOf(end, startIndex + start.length) : -1;
      if (startIndex < 0 || endIndex < 0) {
        if (op.required === false) {
          applied.push({ op: opName, count: 0 });
          return;
        }
        throw new Error(`replace_between markers not found for operation ${index + 1}.`);
      }
      const replacement = String(op.replacement ?? op.content ?? '');
      html = `${html.slice(0, startIndex + start.length)}${replacement}${html.slice(endIndex)}`;
      applied.push({ op: opName, count: 1 });
      return;
    }
    if (opName === 'insert_before' || opName === 'insert_after') {
      const marker = String(op.marker || '').trim();
      if (!marker) throw new Error(`${opName} requires marker.`);
      const markerIndex = html.indexOf(marker);
      if (markerIndex < 0) {
        if (op.required === false) {
          applied.push({ op: opName, count: 0 });
          return;
        }
        throw new Error(`${opName} marker not found: ${marker.slice(0, 80)}`);
      }
      const content = String(op.content ?? '');
      const insertionIndex = opName === 'insert_before' ? markerIndex : markerIndex + marker.length;
      html = `${html.slice(0, insertionIndex)}${content}${html.slice(insertionIndex)}`;
      applied.push({ op: opName, count: 1 });
      return;
    }
    if (opName === 'set_css_var' || opName === 'replace_css_var') {
      const rawName = String(op.name || op.variable || '').trim();
      const name = rawName.startsWith('--') ? rawName : `--${rawName}`;
      const value = String(op.value ?? '').trim();
      if (!/^--[a-z0-9_-]+$/i.test(name) || !value) throw new Error(`${opName} requires a CSS variable name and value.`);
      const pattern = new RegExp(`(${escapeHtmlMotionRegExp(name)}\\s*:\\s*)([^;}{]+)(;)`, 'gi');
      const matches = html.match(pattern);
      if (matches?.length) {
        html = html.replace(pattern, `$1${value}$3`);
        applied.push({ op: opName, name, count: matches.length });
        return;
      }
      if (op.required === false) {
        applied.push({ op: opName, name, count: 0 });
        return;
      }
      throw new Error(`CSS variable not found: ${name}`);
    }
    if (opName === 'replace_asset') {
      const id = sanitizeHtmlMotionAssetId(op.id || op.assetId || '');
      const source = String(op.source || op.path || op.url || '').trim();
      if (!id || !source) throw new Error('replace_asset requires id and source.');
      const [asset] = normalizeHtmlMotionClipAssets(storage, [{
        id,
        source,
        type: op.assetType || op.type,
        label: op.label,
        mimeType: op.mimeType,
      }]);
      const assets = Array.isArray(manifest.assets) ? manifest.assets.filter((existing: any) => sanitizeHtmlMotionAssetId(existing?.id || '') !== id) : [];
      manifest.assets = [...assets, asset];
      const hasPlaceholder = new RegExp(`\\{\\{\\s*(?:asset\\.)?${escapeHtmlMotionRegExp(id)}\\s*\\}\\}|__PROM_ASSET_${escapeHtmlMotionRegExp(id).toUpperCase()}__`, 'i').test(html);
      if (!hasPlaceholder && op.insertPlaceholder) {
        html = `${html}\n<!-- @prometheus-asset ${id}: {{asset.${id}}} -->\n`;
      }
      applied.push({ op: opName, id, count: 1 });
      return;
    }
    if (opName === 'set_manifest') {
      const key = String(op.key || '').trim();
      if (!key || key.includes('__proto__') || key.includes('constructor')) throw new Error('set_manifest requires a safe key.');
      manifest[key] = op.value;
      applied.push({ op: opName, key, count: 1 });
      return;
    }
    throw new Error(`Unsupported HTML motion patch op: ${opName}`);
  });
  return { html, manifest, applied };
}

async function openHtmlMotionPage(options: { url: string; width: number; height: number }): Promise<{ browser: any; context: any; page: any }> {
  const browser = await launchCreativeRenderBrowser();
  const context = await browser.newContext({
    viewport: {
      width: Math.max(1, Math.round(Number(options.width) || 1080)),
      height: Math.max(1, Math.round(Number(options.height) || 1920)),
    },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout?.(10_000);
  page.setDefaultNavigationTimeout?.(15_000);
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.addStyleTag({
    content: 'html,body{margin:0!important;overflow:hidden!important;}',
  });
  return { browser, context, page };
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

async function setHtmlMotionPageTime(page: any, atMs: number): Promise<void> {
  const seconds = Math.max(0, Number(atMs) || 0) / 1000;
  await page.evaluate(`(timeSeconds) => {
    const doc = globalThis.document;
    globalThis.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = timeSeconds;
    globalThis.__PROMETHEUS_HTML_MOTION_TIME_MS__ = Math.round(timeSeconds * 1000);
    try {
      globalThis.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', {
        detail: { timeSeconds, timeMs: Math.round(timeSeconds * 1000) }
      }));
    } catch {}
    try {
      const animations = typeof doc.getAnimations === 'function' ? doc.getAnimations({ subtree: true }) : [];
      for (const animation of animations) {
        try {
          animation.pause();
          animation.currentTime = Math.max(0, Math.round(timeSeconds * 1000));
        } catch {}
      }
    } catch {}
    let style = doc.getElementById('__prometheus_html_motion_clock__');
    if (!style) {
      style = doc.createElement('style');
      style.id = '__prometheus_html_motion_clock__';
      doc.head.appendChild(style);
    }
    style.textContent = '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;}';
    const readSeconds = (el, names, fallback) => {
      for (const name of names) {
        const raw = el.getAttribute(name);
        if (raw === null || raw === '') continue;
        const value = String(raw).trim();
        const numeric = Number(value.replace(/ms$/i, '').replace(/s$/i, ''));
        if (!Number.isFinite(numeric)) continue;
        if (/ms$/i.test(value)) return numeric / 1000;
        if (/s$/i.test(value)) return numeric;
        return numeric / 1000;
      }
      return fallback;
    };
    for (const el of Array.from(doc.querySelectorAll('[data-start],[data-duration],[data-end]'))) {
      const start = readSeconds(el, ['data-start', 'data-from'], 0);
      const duration = readSeconds(el, ['data-duration'], Number.POSITIVE_INFINITY);
      const explicitEnd = readSeconds(el, ['data-end'], Number.NaN);
      const end = Number.isFinite(explicitEnd) ? explicitEnd : start + duration;
      const active = timeSeconds + 0.0001 >= start && timeSeconds < end - 0.0001;
      el.toggleAttribute('data-prometheus-active-frame', active);
      el.toggleAttribute('data-prometheus-inactive-frame', !active);
      if (!el.dataset.prometheusOriginalVisibility) {
        el.dataset.prometheusOriginalVisibility = el.style.visibility || '__empty__';
      }
      el.style.visibility = active ? (el.dataset.prometheusOriginalVisibility === '__empty__' ? '' : el.dataset.prometheusOriginalVisibility) : 'hidden';
    }
  }`, seconds);
  await page.evaluate(`async (timeSeconds) => {
    const media = Array.from(globalThis.document.querySelectorAll('video,audio'));
    const readSeconds = (el, names, fallback) => {
      for (const name of names) {
        const raw = el.getAttribute(name);
        if (raw === null || raw === '') continue;
        const value = String(raw).trim();
        const numeric = Number(value.replace(/ms$/i, '').replace(/s$/i, ''));
        if (!Number.isFinite(numeric)) continue;
        if (/ms$/i.test(value)) return numeric / 1000;
        if (/s$/i.test(value)) return numeric;
        return numeric / 1000;
      }
      return fallback;
    };
    await Promise.all(media.map((node) => new Promise((resolve) => {
      try {
        const elementStart = readSeconds(node, ['data-start', 'data-from'], 0);
        const trimStart = readSeconds(node, ['data-trim-start', 'data-offset'], 0);
        const duration = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : Math.max(0, timeSeconds - elementStart + trimStart);
        const target = Math.max(0, Math.min(duration || 0, timeSeconds - elementStart + trimStart));
        node.pause();
        if (timeSeconds + 0.0001 < elementStart) {
          if (Math.abs((Number(node.currentTime) || 0) - trimStart) >= 0.04) node.currentTime = trimStart;
          resolve(true);
          return;
        }
        if (Math.abs((Number(node.currentTime) || 0) - target) < 0.04) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => resolve(false), 700);
        node.addEventListener('seeked', () => {
          clearTimeout(timer);
          resolve(true);
        }, { once: true });
        node.currentTime = target;
      } catch {
        resolve(false);
      }
    })));
  }`, seconds);
  await page.evaluate(`() => {
    try {
      if (typeof globalThis.__PROMETHEUS_APPLY_HTML_MOTION_FLOW__ === 'function') {
        globalThis.__PROMETHEUS_APPLY_HTML_MOTION_FLOW__();
      }
    } catch {}
  }`);
  await page.evaluate(`() => new Promise((resolve) => {
    const raf = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
    raf(() => raf(() => resolve(true)));
  })`);
  await page.waitForTimeout(20);
}

async function captureHtmlMotionFrames(options: {
  url: string;
  width: number;
  height: number;
  sampleTimesMs: number[];
  framePathForIndex?: (index: number) => string;
  includeDataUrl?: boolean;
  perFrameTimeoutMs?: number;
  onProgress?: (progress: { index: number; total: number; atMs: number }) => void;
}): Promise<Array<{ width: number; height: number; atMs: number; mimeType: string; dataUrl?: string }>> {
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  try {
    ({ browser, context, page } = await openHtmlMotionPage({
      url: options.url,
      width: options.width,
      height: options.height,
    }));
    const frames: Array<{ width: number; height: number; atMs: number; mimeType: string; dataUrl?: string }> = [];
    for (let index = 0; index < options.sampleTimesMs.length; index += 1) {
      const atMs = Math.max(0, Math.round(Number(options.sampleTimesMs[index]) || 0));
      const timeoutMs = Math.max(1000, Math.round(Number(options.perFrameTimeoutMs) || 8000));
      await promiseWithTimeout(setHtmlMotionPageTime(page, atMs), timeoutMs, `HTML motion seek frame ${index + 1}`);
      const pathForFrame = options.framePathForIndex ? options.framePathForIndex(index) : undefined;
      const buffer = await promiseWithTimeout<Buffer>(
        page.screenshot({
          type: 'png',
          path: pathForFrame,
          fullPage: false,
          timeout: timeoutMs,
        }),
        timeoutMs + 500,
        `HTML motion screenshot frame ${index + 1}`,
      );
      frames.push({
        width: Math.max(1, Math.round(Number(options.width) || 1080)),
        height: Math.max(1, Math.round(Number(options.height) || 1920)),
        atMs,
        mimeType: 'image/png',
        dataUrl: options.includeDataUrl === false ? undefined : `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`,
      });
      options.onProgress?.({ index: index + 1, total: options.sampleTimesMs.length, atMs });
    }
    return frames;
  } finally {
    try { await page?.close?.(); } catch {}
    try { await context?.close?.(); } catch {}
    try { await browser?.close?.(); } catch {}
  }
}

async function inspectHtmlMotionPage(options: {
  url: string;
  width: number;
  height: number;
  durationMs: number;
  sampleTimesMs: number[];
  perFrameTimeoutMs?: number;
}): Promise<{
  ok: boolean;
  issueCount: number;
  issues: Array<{ severity: 'info' | 'warning' | 'error'; code: string; message: string; selector?: string; atMs?: number; hint?: string }>;
  samples: Array<{ atMs: number; textIssueCount: number; spatialIssueCount: number; frameHash: string }>;
  frameDelta: { sampleCount: number; exactDuplicateFrameCount: number; staticFrameRatio: number };
}> {
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  const issues: Array<{ severity: 'info' | 'warning' | 'error'; code: string; message: string; selector?: string; atMs?: number; hint?: string }> = [];
  const samples: Array<{ atMs: number; textIssueCount: number; spatialIssueCount: number; frameHash: string }> = [];
  try {
    ({ browser, context, page } = await openHtmlMotionPage({
      url: options.url,
      width: options.width,
      height: options.height,
    }));
    let previousHash = '';
    let exactDuplicateFrameCount = 0;
    for (let index = 0; index < options.sampleTimesMs.length; index += 1) {
      const atMs = Math.max(0, Math.min(Math.max(0, options.durationMs), Math.round(Number(options.sampleTimesMs[index]) || 0)));
      const timeoutMs = Math.max(1000, Math.round(Number(options.perFrameTimeoutMs) || 8000));
      await promiseWithTimeout(setHtmlMotionPageTime(page, atMs), timeoutMs, `HTML motion inspect seek ${index + 1}`);
      const textIssues = await page.evaluate(`(viewport) => {
        function selectorFor(el) {
          if (el.id) return '#' + el.id;
          var role = el.getAttribute && el.getAttribute('data-role');
          if (role) return el.tagName.toLowerCase() + '[data-role="' + role + '"]';
          var cls = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
          return cls ? el.tagName.toLowerCase() + '.' + cls : el.tagName.toLowerCase();
        }
        function isVisible(el) {
          var style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        }
        function hasOwnText(el) {
          var text = '';
          for (var i = 0; i < el.childNodes.length; i += 1) {
            var node = el.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent || '';
          }
          return text.trim().length > 0;
        }
        function clippingAncestor(el, rect) {
          var parent = el.parentElement;
          while (parent && parent !== document.body && parent !== document.documentElement) {
            var style = getComputedStyle(parent);
            if (/(hidden|clip|scroll|auto)/.test(style.overflow + style.overflowX + style.overflowY)) {
              var box = parent.getBoundingClientRect();
              if (rect.left < box.left - 1 || rect.top < box.top - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1) {
                return selectorFor(parent);
              }
            }
            parent = parent.parentElement;
          }
          return null;
        }
        var findings = [];
        Array.from(document.body.querySelectorAll('*')).forEach(function(el) {
          if (!hasOwnText(el) || !isVisible(el)) return;
          var rect = el.getBoundingClientRect();
          var selector = selectorFor(el);
          if (rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
            findings.push({
              severity: 'warning',
              code: 'off-canvas-visible-text',
              selector: selector,
              message: 'Visible text extends outside the composition canvas.'
            });
          }
          var clippedBy = clippingAncestor(el, rect);
          if (clippedBy) {
            findings.push({
              severity: 'warning',
              code: 'clipped-visible-text',
              selector: selector,
              message: 'Visible text appears clipped by ancestor ' + clippedBy + '.'
            });
          }
        });
        return findings;
      }`, { width: options.width, height: options.height });
      const spatialIssues = await page.evaluate(`(viewport) => {
        function selectorFor(el) {
          if (el.id) return '#' + el.id;
          var role = el.getAttribute && el.getAttribute('data-role');
          if (role) return el.tagName.toLowerCase() + '[data-role="' + role + '"]';
          var cls = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
          return cls ? el.tagName.toLowerCase() + '.' + cls : el.tagName.toLowerCase();
        }
        function isVisible(el) {
          var style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 6 && rect.height > 6;
        }
        function isLayoutBody(el) {
          if (!el || el.id === 'prometheus-html-motion-transform-overlay') return false;
          if (el.classList && el.classList.contains('prometheus-html-motion-flow-spacer')) return false;
          if (el.hasAttribute('data-layout-body') || el.hasAttribute('data-flow-exclusion') || el.hasAttribute('data-layout-exclusion') || el.hasAttribute('data-flow-text')) return true;
          var role = String((el.getAttribute && el.getAttribute('data-role')) || '').toLowerCase();
          if (/^(cta|lower-third|chart|headline|flow-text|article-text|body-copy|flow-exclusion|exclusion|orb)$/.test(role)) return true;
          return el.classList && (el.classList.contains('bubble') || el.classList.contains('kicker') || el.classList.contains('stat-card') || el.classList.contains('orb') || el.classList.contains('flow-text') || el.classList.contains('article-copy'));
        }
        function overlap(a, b) {
          var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          return x > 0 && y > 0 ? { x:x, y:y, area:x*y } : null;
        }
        function isFlowPair(a, b) {
          var aFlowText = a.el.hasAttribute('data-flow-text') || /^(flow-text|article-text|body-copy)$/.test(String(a.el.getAttribute('data-role') || '').toLowerCase()) || a.el.classList.contains('flow-text') || a.el.classList.contains('article-copy');
          var bFlowText = b.el.hasAttribute('data-flow-text') || /^(flow-text|article-text|body-copy)$/.test(String(b.el.getAttribute('data-role') || '').toLowerCase()) || b.el.classList.contains('flow-text') || b.el.classList.contains('article-copy');
          var aEx = a.el.hasAttribute('data-flow-exclusion') || a.el.hasAttribute('data-layout-exclusion') || /^(flow-exclusion|exclusion|orb)$/.test(String(a.el.getAttribute('data-role') || '').toLowerCase()) || a.el.classList.contains('orb') || a.el.classList.contains('flow-exclusion');
          var bEx = b.el.hasAttribute('data-flow-exclusion') || b.el.hasAttribute('data-layout-exclusion') || /^(flow-exclusion|exclusion|orb)$/.test(String(b.el.getAttribute('data-role') || '').toLowerCase()) || b.el.classList.contains('orb') || b.el.classList.contains('flow-exclusion');
          return (aFlowText && bEx) || (bFlowText && aEx);
        }
        var raw = Array.from(document.body.querySelectorAll('[data-layout-body],[data-flow-exclusion],[data-layout-exclusion],[data-flow-text],[data-role="cta"],[data-role="lower-third"],[data-role="chart"],[data-role="headline"],[data-role="flow-text"],[data-role="article-text"],[data-role="body-copy"],[data-role="flow-exclusion"],[data-role="exclusion"],[data-role="orb"],.bubble,.kicker,.stat-card,.orb,.flow-text,.article-copy,.flow-exclusion'))
          .filter(function(el){ return isLayoutBody(el) && isVisible(el); });
        var bodies = raw.filter(function(el) {
          return !raw.some(function(other) { return other !== el && other.contains(el) && isLayoutBody(other); });
        }).map(function(el) {
          var rect = el.getBoundingClientRect();
          return { el: el, selector: selectorFor(el), rect: rect, area: Math.max(1, rect.width * rect.height) };
        });
        var findings = [];
        var safe = Math.round(Math.min(viewport.width, viewport.height) * 0.045);
        bodies.forEach(function(body) {
          var r = body.rect;
          if (r.right < -1 || r.bottom < -1 || r.left > viewport.width + 1 || r.top > viewport.height + 1) {
            findings.push({ severity:'error', code:'spatial-off-canvas', selector:body.selector, message:'Layout body is fully outside the composition canvas.' });
          } else if (r.left < -1 || r.top < -1 || r.right > viewport.width + 1 || r.bottom > viewport.height + 1) {
            findings.push({ severity:'warning', code:'spatial-clipped-body', selector:body.selector, message:'Layout body extends outside the composition canvas.' });
          }
          if ((r.left < safe || r.top < safe || r.right > viewport.width - safe || r.bottom > viewport.height - safe) && !/background|stage/i.test(body.selector)) {
            findings.push({ severity:'info', code:'spatial-safe-margin', selector:body.selector, message:'Layout body is inside the recommended video safe margin.' });
          }
        });
        for (var i = 0; i < bodies.length; i += 1) {
          for (var j = i + 1; j < bodies.length; j += 1) {
            var a = bodies[i], b = bodies[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            if (isFlowPair(a, b) && (a.el.getAttribute('data-prometheus-html-motion-flow-active') === 'true' || b.el.getAttribute('data-prometheus-html-motion-flow-active') === 'true')) continue;
            var ov = overlap(a.rect, b.rect);
            if (!ov) continue;
            var ratio = ov.area / Math.max(1, Math.min(a.area, b.area));
            if (ratio > 0.18) {
              findings.push({
                severity: 'warning',
                code: 'spatial-body-overlap',
                selector: a.selector,
                message: a.selector + ' overlaps ' + b.selector + ' by ' + Math.round(ratio * 100) + '% of the smaller body.'
              });
            }
          }
        }
        return findings;
      }`, { width: options.width, height: options.height });
      const buffer = await promiseWithTimeout<Buffer>(
        page.screenshot({ type: 'png', fullPage: false, timeout: timeoutMs }),
        timeoutMs + 500,
        `HTML motion inspect screenshot ${index + 1}`,
      );
      const frameHash = require('crypto').createHash('sha1').update(buffer).digest('hex');
      if (previousHash && frameHash === previousHash) exactDuplicateFrameCount += 1;
      previousHash = frameHash;
      for (const finding of Array.isArray(textIssues) ? textIssues : []) {
        issues.push({ ...finding, atMs });
      }
      for (const finding of Array.isArray(spatialIssues) ? spatialIssues : []) {
        issues.push({ ...finding, atMs });
      }
      samples.push({
        atMs,
        textIssueCount: Array.isArray(textIssues) ? textIssues.length : 0,
        spatialIssueCount: Array.isArray(spatialIssues) ? spatialIssues.length : 0,
        frameHash,
      });
    }
    const staticFrameRatio = samples.length > 1 ? exactDuplicateFrameCount / (samples.length - 1) : 0;
    if (samples.length > 1 && staticFrameRatio >= 0.9) {
      issues.push({
        severity: 'warning',
        code: 'static-frame-samples',
        message: 'Sampled frames are nearly identical. If this clip should have motion, check deterministic seek adapters and timing.',
        hint: 'Use the official prometheus-html-motion-seek event and derive animation state from timeMs/timeSeconds.',
      });
    }
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    return {
      ok: errorCount === 0,
      issueCount: issues.length,
      issues,
      samples,
      frameDelta: { sampleCount: samples.length, exactDuplicateFrameCount, staticFrameRatio },
    };
  } finally {
    try { await page?.close?.(); } catch {}
    try { await context?.close?.(); } catch {}
    try { await browser?.close?.(); } catch {}
  }
}

function buildHtmlMotionQaSampleTimes(durationMs: number, composition: any = {}, maxSamples = 14): number[] {
  const duration = Math.max(1000, Math.round(Number(durationMs) || 8000));
  const samples = new Set<number>([
    0,
    Math.min(duration, 350),
    Math.round(duration * 0.25),
    Math.round(duration * 0.5),
    Math.round(duration * 0.75),
    Math.max(0, duration - 350),
    duration,
  ]);
  const nodes = Array.isArray(composition?.timedNodes) ? composition.timedNodes : [];
  nodes.forEach((node: any) => {
    const start = Math.max(0, Math.min(duration, Math.round(Number(node?.startMs) || 0)));
    const endRaw = Number(node?.endMs);
    const end = Number.isFinite(endRaw) ? Math.max(0, Math.min(duration, Math.round(endRaw))) : null;
    [start - 40, start + 40].forEach((value) => samples.add(Math.max(0, Math.min(duration, Math.round(value)))));
    if (end !== null) [end - 40, end + 40].forEach((value) => samples.add(Math.max(0, Math.min(duration, Math.round(value)))));
  });
  return [...samples]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) >= 25)
    .slice(0, Math.max(3, maxSamples));
}

async function renderHtmlMotionVideoFrames(options: {
  url: string;
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  tempDir: string;
  maxFrames?: number;
  onProgress?: (progress: { phase: 'frames'; index: number; total: number; atMs: number }) => void;
}): Promise<{
  framePattern: string;
  frameCount: number;
  encodedFrameRate: number;
  exactDuplicateFrameCount: number;
}> {
  const requestedFrameRate = Math.max(1, Math.min(60, Math.round(Number(options.frameRate) || 24)));
  const durationMs = Math.max(1, Math.round(Number(options.durationMs) || 8000));
  const maxFrames = Math.max(24, Math.min(1800, Math.round(Number(options.maxFrames) || 720)));
  const frameRate = Math.max(1, Math.min(requestedFrameRate, Math.max(1, Math.floor((maxFrames * 1000) / durationMs))));
  const frameCount = Math.max(1, Math.ceil((durationMs / 1000) * frameRate));
  const sampleTimesMs = Array.from({ length: frameCount }, (_, index) => {
    return Math.min(durationMs, Math.round((index * 1000) / frameRate));
  });
  const framePattern = path.join(options.tempDir, 'frame_%06d.png');
  await captureHtmlMotionFrames({
    url: options.url,
    width: options.width,
    height: options.height,
    sampleTimesMs,
    includeDataUrl: false,
    perFrameTimeoutMs: 8000,
    onProgress: (progress) => {
      if (progress.index === 1 || progress.index === progress.total || progress.index % Math.max(1, Math.ceil(progress.total / 20)) === 0) {
        options.onProgress?.({ phase: 'frames', ...progress });
      }
    },
    framePathForIndex: (index) => path.join(options.tempDir, `frame_${String(index + 1).padStart(6, '0')}.png`),
  });

  let exactDuplicateFrameCount = 0;
  let previousHash = '';
  for (let index = 1; index <= frameCount; index += 1) {
    const framePath = path.join(options.tempDir, `frame_${String(index).padStart(6, '0')}.png`);
    const hash = require('crypto').createHash('sha1').update(fs.readFileSync(framePath)).digest('hex');
    if (previousHash && hash === previousHash) exactDuplicateFrameCount += 1;
    previousHash = hash;
  }

  return {
    framePattern,
    frameCount,
    encodedFrameRate: frameRate,
    exactDuplicateFrameCount,
  };
}

async function maybeFinalizeCreativeRenderArtifact(
  storage: ReturnType<typeof resolveCreativeStorage>,
  record: CreativeRenderJobRecord,
  options: {
    rawBase64: string;
    mimeType: string;
    filename?: string;
    relativePath?: string;
  },
): Promise<{
  artifact: {
    filename: string;
    path: string;
    absPath: string;
    mimeType: string;
    size: number;
  };
  metadata: Record<string, any>;
}> {
  const sourceMimeType = String(options?.mimeType || 'application/octet-stream').trim();
  const desiredFormat = String(record.format || '').trim().toLowerCase();
  const desiredMimeType = desiredFormat === 'mp4' ? 'video/mp4' : sourceMimeType;
  const sourceBuffer = Buffer.from(String(options?.rawBase64 || '').replace(/^data:.*?;base64,/, ''), 'base64');

  if (desiredFormat !== 'mp4' || sourceMimeType === 'video/mp4') {
    return {
      artifact: writeCreativeExportArtifact(storage, {
        buffer: sourceBuffer,
        mimeType: sourceMimeType,
        filename: options.filename,
        relativePath: options.relativePath,
      }),
      metadata: {
        serverFinishRequested: desiredFormat === 'mp4',
        serverFinishStatus: desiredFormat === 'mp4' ? 'already_mp4' : 'not_needed',
        sourceMimeType,
        sourceFormat: creativeFormatFromMimeType(sourceMimeType),
        outputMimeType: desiredFormat === 'mp4' ? 'video/mp4' : sourceMimeType,
        outputFormat: desiredFormat === 'mp4' ? 'mp4' : creativeFormatFromMimeType(sourceMimeType),
      },
    };
  }

  const ffmpegAvailable = await hasCreativeFfmpeg();
  const baseFilename = sanitizeCreativeAssetFilename(
    options.filename || `${record.id}.mp4`,
    `${record.id}.mp4`,
  ).replace(/\.[^.]+$/i, '') || record.id;

  if (!ffmpegAvailable) {
    const fallbackArtifact = writeCreativeExportArtifact(storage, {
      buffer: sourceBuffer,
      mimeType: sourceMimeType,
      filename: `${baseFilename}${extensionForMimeType(sourceMimeType) || '.bin'}`,
      relativePath: options.relativePath,
    });
    return {
      artifact: fallbackArtifact,
      metadata: {
        serverFinishRequested: true,
        serverFinishStatus: 'skipped',
        serverFinishReason: 'ffmpeg_unavailable',
        sourceMimeType,
        sourceFormat: creativeFormatFromMimeType(sourceMimeType),
        outputMimeType: fallbackArtifact.mimeType,
        outputFormat: creativeFormatFromMimeType(fallbackArtifact.mimeType, desiredFormat || 'bin'),
      },
    };
  }

  const tempSourceDir = path.join(storage.renderJobsDir, '_transcode');
  fs.mkdirSync(tempSourceDir, { recursive: true });
  const sourceExt = extensionForMimeType(sourceMimeType) || '.bin';
  const tempSourcePath = path.join(tempSourceDir, `${sanitizeCreativeRenderJobId(record.id)}.${Date.now().toString(36)}${sourceExt}`);
  fs.writeFileSync(tempSourcePath, sourceBuffer);

  let finalArtifact: ReturnType<typeof writeCreativeExportArtifact> | null = null;
  try {
    const finalArtifactFilename = `${baseFilename}.mp4`;
    let finalTargetPath = options.relativePath
      ? path.resolve(storage.exportsDir, sanitizeRelativeUploadPath(String(options.relativePath || '').trim()))
      : path.join(storage.exportsDir, finalArtifactFilename);
    if (!path.extname(finalTargetPath)) finalTargetPath = `${finalTargetPath}.mp4`;
    if (!isPathInside(storage.exportsDir, finalTargetPath)) {
      throw new Error('relativePath must stay within the creative exports directory');
    }
    fs.mkdirSync(path.dirname(finalTargetPath), { recursive: true });
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', tempSourcePath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      finalTargetPath,
    ], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 16,
    });
    const stat = fs.statSync(finalTargetPath);
    finalArtifact = {
      filename: path.basename(finalTargetPath),
      path: buildCreativeStorageRelativePath(storage.workspacePath, finalTargetPath),
      absPath: finalTargetPath,
      mimeType: desiredMimeType,
      size: stat.size,
    };
    return {
      artifact: finalArtifact,
      metadata: {
        serverFinishRequested: true,
        serverFinishStatus: 'transcoded',
        sourceMimeType,
        sourceFormat: creativeFormatFromMimeType(sourceMimeType),
        outputMimeType: desiredMimeType,
        outputFormat: 'mp4',
      },
    };
  } catch (err: any) {
    const fallbackArtifact = writeCreativeExportArtifact(storage, {
      buffer: sourceBuffer,
      mimeType: sourceMimeType,
      filename: `${baseFilename}${extensionForMimeType(sourceMimeType) || '.bin'}`,
      relativePath: options.relativePath,
    });
    return {
      artifact: fallbackArtifact,
      metadata: {
        serverFinishRequested: true,
        serverFinishStatus: 'fallback_source',
        serverFinishReason: String(err?.message || err || 'ffmpeg_transcode_failed'),
        sourceMimeType,
        sourceFormat: creativeFormatFromMimeType(sourceMimeType),
        outputMimeType: fallbackArtifact.mimeType,
        outputFormat: creativeFormatFromMimeType(fallbackArtifact.mimeType, desiredFormat || 'bin'),
      },
    };
  } finally {
    try {
      if (fs.existsSync(tempSourcePath)) fs.unlinkSync(tempSourcePath);
    } catch {}
  }
}

type PublishAction = 'github_create_repo' | 'git_commit_push' | 'vercel_create_project' | 'vercel_deploy';

type PendingPublishApproval = {
  id: string;
  sessionId: string;
  action: PublishAction;
  title: string;
  summary: string;
  details: string;
  payload: Record<string, any>;
  createdAt: number;
};

const pendingPublishApprovals = new Map<string, PendingPublishApproval>();

function sanitizeSlug(raw: string, fallback = 'prometheus-project'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function parseGitHubRepoFullName(remoteUrl: string): string | null {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return null;
  const sshMatch = raw.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  const httpMatch = raw.match(/github\.com\/(.+?)(?:\.git)?$/i);
  const name = (sshMatch?.[1] || httpMatch?.[1] || '').replace(/^\/+|\/+$/g, '');
  return name && /^[^/]+\/[^/]+$/.test(name) ? name : null;
}

async function runGit(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', projectRoot, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  }) as Promise<{ stdout: string; stderr: string }>;
}

async function runCommand(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    env: {
      ...process.env,
      ...(env || {}),
    },
  }) as Promise<{ stdout: string; stderr: string }>;
}

async function detectGitProject(projectRoot: string): Promise<any> {
  try {
    const topLevel = (await runGit(projectRoot, ['rev-parse', '--show-toplevel'])).stdout.trim();
    const branch = (await runGit(topLevel, ['branch', '--show-current'])).stdout.trim() || null;
    let remoteUrl: string | null = null;
    try {
      remoteUrl = (await runGit(topLevel, ['remote', 'get-url', 'origin'])).stdout.trim() || null;
    } catch {
      remoteUrl = null;
    }
    let statusShort = '';
    try {
      statusShort = (await runGit(topLevel, ['status', '--short'])).stdout.trim();
    } catch {
      statusShort = '';
    }
    return {
      linked: true,
      repoRoot: topLevel,
      repoRootRelative: path.relative(getWorkspaceRoot(), topLevel).replace(/\\/g, '/'),
      branch,
      remoteUrl,
      repoFullName: parseGitHubRepoFullName(remoteUrl || ''),
      dirty: !!statusShort,
      statusShort,
    };
  } catch {
    return {
      linked: false,
      repoRoot: null,
      repoRootRelative: null,
      branch: null,
      remoteUrl: null,
      repoFullName: null,
      dirty: false,
      statusShort: '',
    };
  }
}

function getVercelCredentials(): { apiKey: string; projectId: string; teamId: string } | null {
  try {
    const envApiKey = String(process.env.VERCEL_API_TOKEN || '').trim();
    const envProjectId = String(process.env.VERCEL_PROJECT_ID || '').trim();
    const envTeamId = String(process.env.VERCEL_TEAM_ID || '').trim();
    if (envApiKey) {
      return { apiKey: envApiKey, projectId: envProjectId, teamId: envTeamId };
    }
  } catch {
    // continue to vault
  }
  try {
    const secret = getVault(getConfig().getConfigDir()).get('integration.vercel.credentials', 'canvas:vercel:get');
    if (!secret) return null;
    const parsed = JSON.parse(secret.expose());
    const apiKey = String(parsed?.apiKey || '').trim();
    if (!apiKey) return null;
    return {
      apiKey,
      projectId: String(parsed?.projectId || '').trim(),
      teamId: String(parsed?.teamId || '').trim(),
    };
  } catch {
    return null;
  }
}

async function vercelApi(pathname: string, init: { token: string; method?: string; body?: any; teamId?: string }): Promise<{ ok: boolean; status: number; data: any }> {
  const url = new URL(`https://api.vercel.com${pathname}`);
  if (init.teamId) url.searchParams.set('teamId', init.teamId);
  const res = await fetch(url.toString(), {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${init.token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let data: any = {};
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

function readLinkedVercelProject(projectRoot: string): { projectId: string | null; orgId: string | null; projectPath: string; projectName: string | null } {
  const projectPath = path.join(projectRoot, '.vercel', 'project.json');
  if (!fs.existsSync(projectPath)) {
    return { projectId: null, orgId: null, projectPath, projectName: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
    return {
      projectId: typeof parsed?.projectId === 'string' ? parsed.projectId : null,
      orgId: typeof parsed?.orgId === 'string' ? parsed.orgId : null,
      projectPath,
      projectName: typeof parsed?.projectName === 'string' ? parsed.projectName : null,
    };
  } catch {
    return { projectId: null, orgId: null, projectPath, projectName: null };
  }
}

async function detectVercelProject(projectRoot: string, explicitLink: CanvasProjectLink | null): Promise<any> {
  const creds = getVercelCredentials();
  const linked = readLinkedVercelProject(projectRoot);
  const projectId = explicitLink?.vercel?.projectId || linked.projectId || creds?.projectId || null;
  const orgId = explicitLink?.vercel?.orgId || linked.orgId || creds?.teamId || null;
  let deploymentUrl = explicitLink?.vercel?.deploymentUrl || null;
  let dashboardUrl = explicitLink?.vercel?.dashboardUrl || null;
  let projectName = explicitLink?.vercel?.projectName || linked.projectName || null;
  if (projectId && creds?.apiKey) {
    try {
      const listRes = await vercelApi(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`, {
        token: creds.apiKey,
        teamId: creds.teamId || orgId || undefined,
      });
      const latest = listRes.data?.deployments?.[0];
      if (latest?.url) deploymentUrl = `https://${latest.url}`;
    } catch {
      // best effort only
    }
    dashboardUrl = dashboardUrl || `https://vercel.com/dashboard`;
  }
  return {
    linked: !!projectId,
    projectId,
    orgId,
    projectName,
    deploymentUrl,
    dashboardUrl,
    localConfigPath: fs.existsSync(linked.projectPath) ? path.relative(getWorkspaceRoot(), linked.projectPath).replace(/\\/g, '/') : null,
  };
}

async function getGitHubConnectionState(): Promise<{ connected: boolean; hasCredentials: boolean }> {
  try {
    const { getConnectorStatuses } = require('../../integrations/connector-registry.js') as any;
    const statuses = getConnectorStatuses();
    const github = statuses?.github || {};
    return {
      connected: !!github.connected,
      hasCredentials: !!github.hasCredentials,
    };
  } catch {
    return { connected: false, hasCredentials: false };
  }
}

async function buildProjectPublishState(sessionId: string): Promise<any> {
  const projectRoot = getCanvasProjectRoot(sessionId);
  const projectLabel = getCanvasProjectLabel(sessionId);
  const explicitLink = getCanvasProjectLink(sessionId);
  const githubConnection = await getGitHubConnectionState();
  const vercelCreds = getVercelCredentials();
  if (!projectRoot) {
    return {
      projectRoot: null,
      projectLabel: null,
      explicitLink,
      githubConnection,
      vercelConnection: { connected: !!vercelCreds?.apiKey, hasCredentials: !!vercelCreds?.apiKey },
      git: null,
      vercel: null,
      publish: { canCreateRepo: false, canCommitPush: false, canCreateVercelProject: false, canDeploy: false },
    };
  }
  const git = await detectGitProject(projectRoot);
  const vercel = await detectVercelProject(git.repoRoot || projectRoot, explicitLink);
  return {
    projectRoot,
    projectLabel,
    explicitLink,
    githubConnection,
    vercelConnection: { connected: !!vercelCreds?.apiKey, hasCredentials: !!vercelCreds?.apiKey },
    git,
    vercel,
    publish: {
      canCreateRepo: !!projectRoot && !!githubConnection.connected && (!git.linked || !git.remoteUrl || !git.repoFullName),
      canCommitPush: !!projectRoot && !!git.linked && !!git.remoteUrl,
      canCreateVercelProject: !!projectRoot && !!vercelCreds?.apiKey && !vercel.linked,
      canDeploy: !!projectRoot && !!vercelCreds?.apiKey,
    },
  };
}

async function ensureGitRepo(projectRoot: string): Promise<{ repoRoot: string; branch: string | null }> {
  const current = await detectGitProject(projectRoot);
  if (current.linked && current.repoRoot) {
    return { repoRoot: current.repoRoot, branch: current.branch || 'main' };
  }
  fs.mkdirSync(projectRoot, { recursive: true });
  try {
    await runGit(projectRoot, ['init', '-b', 'main']);
  } catch {
    await runGit(projectRoot, ['init']);
    try { await runGit(projectRoot, ['checkout', '-B', 'main']); } catch {}
  }
  return { repoRoot: projectRoot, branch: 'main' };
}

function buildPublishApproval(sessionId: string, action: PublishAction, title: string, summary: string, details: string, payload: Record<string, any>): PendingPublishApproval {
  const record: PendingPublishApproval = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    action,
    title,
    summary,
    details,
    payload,
    createdAt: Date.now(),
  };
  pendingPublishApprovals.set(record.id, record);
  return record;
}

async function executeGithubCreateRepo(sessionId: string, payload: Record<string, any>): Promise<any> {
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) throw new Error('No active project root.');
  const repoName = sanitizeSlug(String(payload.repoName || path.basename(projectRoot)));
  const description = String(payload.description || '').trim();
  const isPrivate = payload.private !== false;
  const { getConnector } = require('../../integrations/connector-registry.js') as any;
  const connector = getConnector('github');
  if (!connector || typeof connector.createRepo !== 'function') throw new Error('GitHub is not connected.');
  const created = await connector.createRepo(repoName, { description, private: isPrivate, autoInit: false });
  const ensured = await ensureGitRepo(projectRoot);
  const remoteUrl = created?.clone_url || created?.ssh_url || created?.html_url;
  if (!remoteUrl) throw new Error('GitHub repo created but no remote URL was returned.');
  try {
    const existingRemote = (await runGit(ensured.repoRoot, ['remote', 'get-url', 'origin'])).stdout.trim();
    if (existingRemote) {
      await runGit(ensured.repoRoot, ['remote', 'set-url', 'origin', remoteUrl]);
    }
  } catch {
    await runGit(ensured.repoRoot, ['remote', 'add', 'origin', remoteUrl]);
  }
  const link = setCanvasProjectLink(sessionId, {
    ...(getCanvasProjectLink(sessionId) || {}),
    rootPath: projectRoot,
    github: {
      repoFullName: created?.full_name || parseGitHubRepoFullName(remoteUrl),
      remoteUrl,
      branch: ensured.branch || 'main',
      defaultBranch: created?.default_branch || 'main',
    },
    vercel: getCanvasProjectLink(sessionId)?.vercel || null,
  });
  return {
    success: true,
    summary: `GitHub repo created and linked: ${created?.full_name || repoName}`,
    github: link?.github || null,
    repoUrl: created?.html_url || null,
  };
}

async function executeGitCommitPush(sessionId: string, payload: Record<string, any>): Promise<any> {
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) throw new Error('No active project root.');
  const git = await detectGitProject(projectRoot);
  if (!git.linked || !git.repoRoot) throw new Error('This project is not inside a git repository.');
  if (!git.remoteUrl) throw new Error('No origin remote is configured for this project.');
  const commitMessage = String(payload.commitMessage || '').trim();
  if (!commitMessage) throw new Error('Commit message is required.');
  const branch = git.branch || 'main';
  const status = (await runGit(git.repoRoot, ['status', '--short'])).stdout.trim();
  if (!status) throw new Error('No local changes to commit.');
  await runGit(git.repoRoot, ['add', '-A']);
  await runGit(git.repoRoot, ['commit', '-m', commitMessage]);
  await runGit(git.repoRoot, ['push', '-u', 'origin', branch]);
  const link = setCanvasProjectLink(sessionId, {
    ...(getCanvasProjectLink(sessionId) || {}),
    rootPath: projectRoot,
    github: {
      ...(getCanvasProjectLink(sessionId)?.github || {}),
      repoFullName: git.repoFullName || getCanvasProjectLink(sessionId)?.github?.repoFullName || null,
      remoteUrl: git.remoteUrl,
      branch,
    },
    vercel: getCanvasProjectLink(sessionId)?.vercel || null,
  });
  return {
    success: true,
    summary: `Committed and pushed to ${link?.github?.repoFullName || git.remoteUrl}`,
    github: link?.github || null,
  };
}

async function executeVercelCreateProject(sessionId: string, payload: Record<string, any>): Promise<any> {
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) throw new Error('No active project root.');
  const creds = getVercelCredentials();
  if (!creds?.apiKey) throw new Error('Vercel is not connected.');
  const projectName = sanitizeSlug(String(payload.projectName || path.basename(projectRoot)));
  const created = await vercelApi('/v10/projects', {
    token: creds.apiKey,
    teamId: creds.teamId || undefined,
    method: 'POST',
    body: { name: projectName },
  });
  if (!created.ok) {
    throw new Error(`Vercel project creation failed (${created.status}).`);
  }
  const projectId = String(created.data?.id || '').trim();
  const orgId = String(created.data?.accountId || creds.teamId || '').trim();
  fs.mkdirSync(path.join(projectRoot, '.vercel'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.vercel', 'project.json'),
    JSON.stringify({ projectId, orgId, projectName }, null, 2),
    'utf-8'
  );
  const link = setCanvasProjectLink(sessionId, {
    ...(getCanvasProjectLink(sessionId) || {}),
    rootPath: projectRoot,
    github: getCanvasProjectLink(sessionId)?.github || null,
    vercel: {
      projectId,
      projectName,
      teamId: creds.teamId || null,
      orgId: orgId || null,
      dashboardUrl: 'https://vercel.com/dashboard',
      deploymentUrl: getCanvasProjectLink(sessionId)?.vercel?.deploymentUrl || null,
    },
  });
  return {
    success: true,
    summary: `Vercel project created: ${projectName}`,
    vercel: link?.vercel || null,
  };
}

async function executeVercelDeploy(sessionId: string): Promise<any> {
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) throw new Error('No active project root.');
  const creds = getVercelCredentials();
  if (!creds?.apiKey) throw new Error('Vercel is not connected.');
  const linked = readLinkedVercelProject(projectRoot);
  const orgId = linked.orgId || creds.teamId || getCanvasProjectLink(sessionId)?.vercel?.orgId || '';
  const env = {
    VERCEL_TOKEN: creds.apiKey,
    VERCEL_ORG_ID: orgId,
    VERCEL_PROJECT_ID: linked.projectId || getCanvasProjectLink(sessionId)?.vercel?.projectId || creds.projectId || '',
  };
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'vercel', args: ['deploy', '--prod', '--yes', '--token', creds.apiKey] },
    { cmd: 'npx', args: ['-y', 'vercel', 'deploy', '--prod', '--yes', '--token', creds.apiKey] },
  ];
  let stdout = '';
  let stderr = '';
  let lastErr: any = null;
  for (const attempt of attempts) {
    try {
      const res = await runCommand(attempt.cmd, attempt.args, projectRoot, env);
      stdout = String(res.stdout || '');
      stderr = String(res.stderr || '');
      lastErr = null;
      break;
    } catch (err: any) {
      lastErr = err;
      stdout = String(err?.stdout || '');
      stderr = String(err?.stderr || err?.message || '');
    }
  }
  if (lastErr) {
    throw new Error(stderr || lastErr?.message || 'Vercel deploy failed.');
  }
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi);
  const deploymentUrl = match ? match[match.length - 1] : null;
  const currentLink = getCanvasProjectLink(sessionId);
  const nextLink = setCanvasProjectLink(sessionId, {
    ...(currentLink || {}),
    rootPath: projectRoot,
    github: currentLink?.github || null,
    vercel: {
      ...(currentLink?.vercel || {}),
      projectId: currentLink?.vercel?.projectId || linked.projectId || creds.projectId || null,
      projectName: currentLink?.vercel?.projectName || linked.projectName || path.basename(projectRoot),
      teamId: currentLink?.vercel?.teamId || creds.teamId || null,
      orgId: currentLink?.vercel?.orgId || orgId || null,
      deploymentUrl,
      dashboardUrl: currentLink?.vercel?.dashboardUrl || 'https://vercel.com/dashboard',
    },
  });
  return {
    success: true,
    summary: deploymentUrl ? `Deployment ready: ${deploymentUrl}` : 'Vercel deployment triggered.',
    vercel: nextLink?.vercel || null,
    deploymentUrl,
    logs: combined.trim().slice(-4000),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/canvas/file?path=<workspace-relative-path>
// Returns file content from the workspace for the canvas to display.
router.get('/api/canvas/file', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).json({ success: false, error: 'path query param required' }); return; }
  let workspacePath = '';
  let absPath = '';
  try {
    const resolved = resolveCanvasPath(relPath);
    workspacePath = resolved.workspacePath;
    absPath = resolved.absPath;
  } catch {
    res.status(403).json({ success: false, error: 'Path outside workspace' }); return;
  }
  try {
    if (!fs.existsSync(absPath)) { res.status(404).json({ success: false, error: 'File not found' }); return; }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) { res.status(400).json({ success: false, error: 'Path is a directory' }); return; }
    // Detect image files — return as base64 instead of trying to read as utf-8
    const ext = path.extname(absPath).toLowerCase().slice(1);
    const IMAGE_EXTS: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      ico: 'image/x-icon', svg: 'image/svg+xml',
      tiff: 'image/tiff', tif: 'image/tiff',
    };
    const BINARY_EXTS: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint',
    };
    if (IMAGE_EXTS[ext]) {
      const buffer = fs.readFileSync(absPath);
      const base64 = buffer.toString('base64');
      const mimeType = IMAGE_EXTS[ext];
      res.json({ success: true, path: relPath, absPath, isImage: true, base64, mimeType, size: stat.size, mtime: stat.mtime });
      return;
    }
    if (BINARY_EXTS[ext]) {
      res.json({ success: true, path: relPath, absPath, isBinary: true, mimeType: BINARY_EXTS[ext], ext, size: stat.size, mtime: stat.mtime });
      return;
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    res.json({ success: true, path: relPath, absPath, content, size: stat.size, mtime: stat.mtime });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/file  body: { path, content }
// Writes content back to the workspace file from the canvas.
router.post('/api/canvas/file', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.body?.path || '').trim();
  const content = req.body?.content;
  if (!relPath) { res.status(400).json({ success: false, error: 'path required' }); return; }
  if (typeof content !== 'string') { res.status(400).json({ success: false, error: 'content must be a string' }); return; }
  let absPath = '';
  try {
    absPath = resolveCanvasPath(relPath).absPath;
  } catch {
    res.status(403).json({ success: false, error: 'Path outside workspace' }); return;
  }
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    _broadcastWS({ type: 'canvas_saved', path: relPath, absPath, size: content.length });
    res.json({ success: true, path: relPath, absPath, size: content.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/upload  body: { filename, content (text) }
// Copies a user-uploaded file into workspace/uploads/ so the AI can work on it
// without touching the user's original. Returns the workspace path for canvas.
router.post('/api/canvas/upload', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const rawName = String(req.body?.filename || '').trim().replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const content  = req.body?.content;
  const rawRelativePath = sanitizeRelativeUploadPath(String(req.body?.relativePath || '').trim());
  if (!rawName) { res.status(400).json({ success: false, error: 'filename required' }); return; }
  if (typeof content !== 'string') { res.status(400).json({ success: false, error: 'content must be a string' }); return; }
  const workspacePath = getWorkspaceRoot();
  const uploadsDir = path.join(workspacePath, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  let finalName = rawName;
  let targetRelPath = rawRelativePath || finalName;
  if (!rawRelativePath && fs.existsSync(path.join(uploadsDir, finalName))) {
    const ts = Date.now();
    const dot = rawName.lastIndexOf('.');
    finalName = dot > 0 ? rawName.slice(0, dot) + '_' + ts + rawName.slice(dot) : rawName + '_' + ts;
    targetRelPath = finalName;
  }
  const absPath = path.join(uploadsDir, targetRelPath);
  const relPath = path.relative(workspacePath, absPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    res.json({ success: true, filename: finalName, relPath, absPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/canvas/upload-binary  body: { filename, base64, mimeType }
// Saves a binary file (image, pdf, docx, xls…) from base64 into workspace/uploads/
router.post('/api/canvas/upload-binary', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const rawName = String(req.body?.filename || '').trim().replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const base64  = req.body?.base64;
  const rawRelativePath = sanitizeRelativeUploadPath(String(req.body?.relativePath || '').trim());
  if (!rawName) { res.status(400).json({ success: false, error: 'filename required' }); return; }
  if (typeof base64 !== 'string' || !base64) { res.status(400).json({ success: false, error: 'base64 required' }); return; }
  const workspacePath = getWorkspaceRoot();
  const uploadsDir = path.join(workspacePath, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  let finalName = rawName;
  let targetRelPath = rawRelativePath || finalName;
  if (!rawRelativePath && fs.existsSync(path.join(uploadsDir, finalName))) {
    const ts = Date.now();
    const dot = rawName.lastIndexOf('.');
    finalName = dot > 0 ? rawName.slice(0, dot) + '_' + ts + rawName.slice(dot) : rawName + '_' + ts;
    targetRelPath = finalName;
  }
  const absPath = path.join(uploadsDir, targetRelPath);
  const relPath = path.relative(workspacePath, absPath);
  try {
    // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
    const pureBase64 = base64.replace(/^data:.*?;base64,/, '');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(pureBase64, 'base64'));
    res.json({ success: true, filename: finalName, relPath, absPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/canvas/download', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) {
    res.status(400).json({ success: false, error: 'path query param required' });
    return;
  }
  try {
    const { absPath } = resolveCanvasPath(relPath);
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      res.status(400).json({ success: false, error: 'Path is a directory' });
      return;
    }
    const contentType = String(guessContentType(absPath) || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-store');
    res.type(contentType);
    res.download(absPath, path.basename(absPath));
  } catch (err: any) {
    const message = String(err?.message || 'Download failed');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/inline', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) {
    res.status(400).json({ success: false, error: 'path query param required' });
    return;
  }
  try {
    const { absPath } = resolveCanvasPath(relPath);
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      res.status(400).json({ success: false, error: 'Path is a directory' });
      return;
    }
    const contentType = String(guessContentType(absPath) || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    const filename = path.basename(absPath).replace(/"/g, '');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.type(contentType);
    res.sendFile(absPath);
  } catch (err: any) {
    const message = String(err?.message || 'Inline preview failed');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/preview-document', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) {
    res.status(400).send('path query param required');
    return;
  }
  try {
    const { absPath } = resolveCanvasPath(relPath);
    if (!fs.existsSync(absPath)) {
      res.status(404).send('File not found');
      return;
    }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      res.status(400).send('Path is a directory');
      return;
    }
    const previewKind = getCanvasDocumentPreviewKind(absPath);
    if (previewKind === 'pdf') {
      res.redirect(`/api/canvas/inline?path=${encodeURIComponent(relPath)}`);
      return;
    }
    let html = '';
    if (previewKind === 'docx') {
      html = await buildDocxPreviewHtml(absPath, stat);
    } else if (previewKind === 'spreadsheet') {
      html = await buildSpreadsheetPreviewHtml(absPath, stat);
    } else if (previewKind === 'presentation') {
      html = await buildPptxPreviewHtml(absPath, stat);
    } else {
      html = buildUnsupportedDocumentPreviewHtml(absPath, stat);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (err: any) {
    const message = String(err?.message || 'Preview failed');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).send(buildCanvasDocumentShell({
      title: 'Canvas Preview Error',
      eyebrow: 'Preview Error',
      summary: message,
      bodyHtml: `<div class="panel-card preview-empty">${escapePreviewHtml(message)}</div>`,
    }));
  }
});

// GET /api/canvas/files  — lists workspace files for the canvas file browser
router.get('/api/canvas/files', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default');
  const requestedRoot = String(req.query?.root || '').trim();
  const workspacePath = getWorkspaceRoot();
  let rootAbsPath = workspacePath;
  let rootRelPath = '';
  if (requestedRoot) {
    try {
      const resolved = resolveCanvasPath(requestedRoot);
      rootAbsPath = resolved.absPath;
      rootRelPath = resolved.relPath;
    } catch {
      res.status(403).json({ success: false, error: 'Path outside workspace' }); return;
    }
  } else {
    const sessionRoot = getCanvasProjectRoot(sessionId);
    if (sessionRoot) {
      try {
        const resolved = resolveCanvasPath(sessionRoot);
        rootAbsPath = resolved.absPath;
        rootRelPath = resolved.relPath;
      } catch {
        rootAbsPath = workspacePath;
        rootRelPath = '';
      }
    }
  }
  if (!fs.existsSync(rootAbsPath) || !fs.statSync(rootAbsPath).isDirectory()) {
    res.status(404).json({ success: false, error: 'Directory not found' }); return;
  }
  res.json({
    success: true,
    files: buildWorkspaceTree(rootAbsPath, rootRelPath),
    rootPath: rootRelPath || '',
    rootAbsPath,
    projectRoot: getCanvasProjectRoot(sessionId) || null,
    projectLabel: getCanvasProjectLabel(sessionId) || null,
  });
});

// POST /api/canvas/open  body: { sessionId, path }
// Registers a file as open in the canvas so the AI knows its exact path.
router.post('/api/canvas/open', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const { sessionId = 'default', path: filePath } = req.body;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = require('path').isAbsolute(filePath)
    ? filePath
    : require('path').join(workspacePath, filePath);
  addCanvasFile(String(sessionId), absPath);
  res.json({ success: true, tracked: sessionCanvasFiles.get(String(sessionId)) || [] });
});

// POST /api/canvas/close  body: { sessionId, path }
// Removes a file from the canvas tracking when the user closes its tab.
router.post('/api/canvas/close', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const { sessionId = 'default', path: filePath } = req.body;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = require('path').isAbsolute(filePath)
    ? filePath
    : require('path').join(workspacePath, filePath);
  removeCanvasFile(String(sessionId), absPath);
  res.json({ success: true, tracked: sessionCanvasFiles.get(String(sessionId)) || [] });
});

// POST /api/canvas/project-root  body: { sessionId, rootPath, label }
router.post('/api/canvas/project-root', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default');
  const rawRoot = String(req.body?.rootPath || '').trim();
  const rawLabel = String(req.body?.label || '').trim();
  if (!rawRoot) {
    const cleared = setCanvasProject(sessionId, null, null);
    _broadcastWS({ type: 'canvas_project_changed', sessionId, projectRoot: cleared.rootPath, projectLabel: cleared.label });
    res.json({ success: true, sessionId, projectRoot: cleared.rootPath, projectLabel: cleared.label });
    return;
  }
  try {
    const resolved = resolveCanvasPath(rawRoot);
    if (!fs.existsSync(resolved.absPath) || !fs.statSync(resolved.absPath).isDirectory()) {
      res.status(404).json({ success: false, error: 'Project root directory not found' }); return;
    }
    const saved = setCanvasProject(sessionId, resolved.absPath, rawLabel || path.basename(resolved.absPath));
    _broadcastWS({ type: 'canvas_project_changed', sessionId, projectRoot: saved.rootPath, projectLabel: saved.label });
    res.json({ success: true, sessionId, projectRoot: saved.rootPath, projectLabel: saved.label });
  } catch (err: any) {
    res.status(403).json({ success: false, error: err.message || 'Invalid project root' });
  }
});

router.get('/api/canvas/project-preview/:sessionId', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.params?.sessionId || 'default');
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) {
    res.status(400).send('No active canvas project root.');
    return;
  }
  res.redirect(`/api/canvas/project-preview/${encodeURIComponent(sessionId)}/index.html`);
});

router.get('/api/canvas/project-preview/:sessionId/*', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.params?.sessionId || 'default');
  const projectRoot = getCanvasProjectRoot(sessionId);
  if (!projectRoot) {
    res.status(400).send('No active canvas project root.');
    return;
  }
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    res.status(404).send('Project root not found.');
    return;
  }

  const wildcardPath = Array.isArray(req.params?.[0]) ? req.params[0].join('/') : String(req.params?.[0] || '');
  const requestedPath = wildcardPath
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

  const resolvedPath = path.resolve(projectRoot, requestedPath || 'index.html');
  if (resolvedPath !== projectRoot && !ensureInsideRoot(projectRoot, resolvedPath)) {
    res.status(403).send('Forbidden');
    return;
  }

  let filePath = resolvedPath;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.status(404).send('Preview file not found.');
    return;
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type(guessContentType(filePath));
  res.sendFile(filePath, (err: any) => {
    if (err && !res.headersSent) {
      res.status(err.statusCode || 500).send(err.message || 'Could not load project preview.');
    }
  });
});

router.get('/api/canvas/creative-render-ui', (_req: any, res: any) => {
  res.redirect('/api/canvas/creative-render-ui/index.html');
});

router.get('/api/canvas/creative-render-ui/*', (req: any, res: any) => {
  try {
    const wildcardPath = Array.isArray(req.params?.[0]) ? req.params[0].join('/') : String(req.params?.[0] || '');
    const filePath = resolveCreativeRenderUiPath(wildcardPath || 'index.html');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).send('Render UI file not found.');
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type(guessContentType(filePath));
    res.sendFile(filePath, (err: any) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode || 500).send(err.message || 'Could not load creative render UI asset.');
      }
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not load creative render UI asset.');
    res.status(/outside/i.test(message) ? 403 : 500).send(message);
  }
});

router.get('/api/canvas/project-export', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  try {
    const sessionId = String(req.query?.sessionId || 'default').trim();
    const format = String(req.query?.format || 'zip').trim().toLowerCase();
    const projectRoot = getCanvasProjectRoot(sessionId);
    const projectLabel = getCanvasProjectLabel(sessionId) || (projectRoot ? path.basename(projectRoot) : 'prometheus-project');
    if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      res.status(400).json({ success: false, error: 'No active canvas project root.' });
      return;
    }

    if (format === 'zip') {
      const archiveName = `${sanitizeSlug(projectLabel)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: Error) => {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message || 'Could not build ZIP export.' });
        else res.end();
      });
      archive.pipe(res);
      archive.directory(projectRoot, false);
      await archive.finalize();
      return;
    }

    if (format === 'html') {
      const entryRaw = String(req.query?.entry || 'index.html').trim() || 'index.html';
      const entryPath = path.resolve(projectRoot, entryRaw);
      if (!isPathInside(projectRoot, entryPath) || !fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
        res.status(404).json({ success: false, error: 'Preview entry file was not found.' });
        return;
      }
      if (!/\.html?$/i.test(entryPath)) {
        res.status(400).json({ success: false, error: 'Standalone export requires an HTML entry file.' });
        return;
      }
      const html = inlineStandaloneHtml(entryPath, projectRoot);
      const fileName = `${sanitizeSlug(path.basename(entryPath, path.extname(entryPath)) || projectLabel)}-standalone.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(html);
      return;
    }

    res.status(400).json({ success: false, error: 'Unknown export format.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Could not export project.' });
  }
});

router.get('/api/canvas/project-link', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  try {
    const sessionId = String(req.query?.sessionId || 'default');
    const state = await buildProjectPublishState(sessionId);
    res.json({ success: true, sessionId, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Could not load project link state' });
  }
});

router.post('/api/canvas/publish/prepare', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  try {
    const sessionId = String(req.body?.sessionId || 'default');
    const action = String(req.body?.action || '').trim() as PublishAction;
    const state = await buildProjectPublishState(sessionId);
    if (!state.projectRoot) {
      res.status(400).json({ success: false, error: 'Set a canvas project root before publishing.' });
      return;
    }
    if (!['github_create_repo', 'git_commit_push', 'vercel_create_project', 'vercel_deploy'].includes(action)) {
      res.status(400).json({ success: false, error: 'Unknown publish action.' });
      return;
    }
    if (action === 'github_create_repo') {
      if (!state.githubConnection.connected) {
        res.status(400).json({ success: false, error: 'GitHub is not connected.' });
        return;
      }
      const repoName = sanitizeSlug(String(req.body?.repoName || state.projectLabel || path.basename(state.projectRoot)));
      const visibility = req.body?.private === false ? 'public' : 'private';
      const details = [
        `Action: Create GitHub repository`,
        `Project root: ${state.projectRoot}`,
        `Repository: ${repoName}`,
        `Visibility: ${visibility}`,
        `Then run locally:`,
        `  git init -b main`,
        `  git remote add origin https://github.com/<you>/${repoName}.git`,
      ].join('\n');
      const approval = buildPublishApproval(
        sessionId,
        action,
        'Create GitHub Repo',
        `Create a ${visibility} GitHub repo named "${repoName}" and link this project root to it.`,
        details,
        {
          repoName,
          description: String(req.body?.description || '').trim(),
          private: req.body?.private !== false,
        }
      );
      res.json({ success: true, approval, state });
      return;
    }
    if (action === 'git_commit_push') {
      if (!state.git?.linked || !state.git?.remoteUrl) {
        res.status(400).json({ success: false, error: 'This project is not linked to a GitHub remote yet.' });
        return;
      }
      const commitMessage = String(req.body?.commitMessage || '').trim();
      if (!commitMessage) {
        res.status(400).json({ success: false, error: 'Commit message is required.' });
        return;
      }
      const branch = state.git.branch || 'main';
      const details = [
        `Action: Commit and push`,
        `Project root: ${state.git.repoRoot}`,
        `Remote: ${state.git.remoteUrl}`,
        `Branch: ${branch}`,
        `Commit message: ${commitMessage}`,
        `Commands:`,
        `  git -C "${state.git.repoRoot}" add -A`,
        `  git -C "${state.git.repoRoot}" commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
        `  git -C "${state.git.repoRoot}" push -u origin ${branch}`,
      ].join('\n');
      const approval = buildPublishApproval(
        sessionId,
        action,
        'Commit & Push',
        `Commit local changes and push them to ${state.git.repoFullName || state.git.remoteUrl}.`,
        details,
        { commitMessage }
      );
      res.json({ success: true, approval, state });
      return;
    }
    if (action === 'vercel_create_project') {
      if (!state.vercelConnection.connected) {
        res.status(400).json({ success: false, error: 'Vercel is not connected.' });
        return;
      }
      const projectName = sanitizeSlug(String(req.body?.projectName || state.projectLabel || path.basename(state.projectRoot)));
      const details = [
        `Action: Create Vercel project`,
        `Project root: ${state.projectRoot}`,
        `Vercel project: ${projectName}`,
        `Artifacts:`,
        `  .vercel/project.json`,
        `API call:`,
        `  POST https://api.vercel.com/v10/projects`,
      ].join('\n');
      const approval = buildPublishApproval(
        sessionId,
        action,
        'Create Vercel Project',
        `Create and link a Vercel project named "${projectName}" for this canvas project.`,
        details,
        { projectName }
      );
      res.json({ success: true, approval, state });
      return;
    }
    const details = [
      `Action: Deploy to Vercel`,
      `Project root: ${state.projectRoot}`,
      `Linked project: ${state.vercel?.projectName || state.vercel?.projectId || '(auto-detect)'}`,
      `Commands:`,
      `  vercel deploy --prod --yes --token ****`,
      `Fallback:`,
      `  npx -y vercel deploy --prod --yes --token ****`,
    ].join('\n');
    const approval = buildPublishApproval(
      sessionId,
      action,
      'Deploy to Vercel',
      'Deploy the current project root to Vercel and surface the live URL back into the canvas.',
      details,
      {}
    );
    res.json({ success: true, approval, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Could not prepare publish action' });
  }
});

router.post('/api/canvas/publish/execute/:id', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const approvalId = String(req.params.id || '').trim();
  const approved = req.body?.approved !== false;
  const pending = pendingPublishApprovals.get(approvalId);
  if (!pending) {
    res.status(404).json({ success: false, error: 'Publish approval not found.' });
    return;
  }
  pendingPublishApprovals.delete(approvalId);
  if (!approved) {
    res.json({ success: true, approved: false });
    return;
  }
  try {
    let result: any = null;
    if (pending.action === 'github_create_repo') result = await executeGithubCreateRepo(pending.sessionId, pending.payload);
    else if (pending.action === 'git_commit_push') result = await executeGitCommitPush(pending.sessionId, pending.payload);
    else if (pending.action === 'vercel_create_project') result = await executeVercelCreateProject(pending.sessionId, pending.payload);
    else if (pending.action === 'vercel_deploy') result = await executeVercelDeploy(pending.sessionId);
    const state = await buildProjectPublishState(pending.sessionId);
    _broadcastWS({ type: 'canvas_project_changed', sessionId: pending.sessionId, projectRoot: state.projectRoot, projectLabel: state.projectLabel });
    _broadcastWS({ type: 'canvas_publish_state', sessionId: pending.sessionId, state });
    res.json({ success: true, approved: true, result, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Publish action failed' });
  }
});

router.post('/api/canvas/html-motion-clip', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const html = String(req.body?.html || '').trim();
  if (!html) {
    res.status(400).json({ success: false, error: 'html is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const dir = getHtmlMotionDir(storage);
    const nowIso = new Date().toISOString();
    const id = `html_motion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const filename = sanitizeHtmlMotionFilename(req.body?.filename, `${id}.html`);
    const targetPath = path.join(dir, filename);
    if (!isPathInside(dir, targetPath)) {
      res.status(400).json({ success: false, error: 'filename must stay inside the HTML motion directory' });
      return;
    }
    const assets = normalizeHtmlMotionClipAssets(storage, Array.isArray(req.body?.assets) ? req.body.assets : []);
    fs.writeFileSync(targetPath, html, 'utf-8');
    const manifestPath = path.join(dir, `${path.basename(filename).replace(/\.[^.]+$/i, '')}.json`);
    const manifest = {
      kind: 'prometheus-html-motion-clip',
      version: 1,
      id,
      sessionId,
      creativeMode: 'video',
      title: String(req.body?.title || '').trim() || path.basename(filename, path.extname(filename)),
      width: Math.max(320, Number(req.body?.width) || 1080),
      height: Math.max(320, Number(req.body?.height) || 1920),
      durationMs: Math.max(1000, Number(req.body?.durationMs) || 8000),
      frameRate: Math.max(1, Math.min(120, Number(req.body?.frameRate) || 30)),
      htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, targetPath),
      assets,
      template: req.body?.template && typeof req.body.template === 'object' ? req.body.template : null,
      templateId: String(req.body?.templateId || req.body?.template?.id || '').trim() || null,
      parameters: Array.isArray(req.body?.parameters) ? req.body.parameters : [],
      parameterValues: req.body?.parameterValues && typeof req.body.parameterValues === 'object' ? req.body.parameterValues : {},
      storageRoot: storage.rootRelPath,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    Object.assign(manifest, buildHtmlMotionCompositionMetadata(html, manifest));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    const clip = buildHtmlMotionClipEntry(storage, targetPath, manifestPath, manifest);
    _broadcastWS({
      type: 'creative_html_motion_clip_saved',
      sessionId,
      creativeMode: 'video',
      clip,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      clip,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not save HTML motion clip');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/read', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath, relPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifestPath, manifest } = readHtmlMotionManifest(storage, absPath);
    const source = buildHtmlMotionSourcePayload(storage, absPath, manifestPath, manifest, {
      includeHtml: req.body?.includeHtml !== false,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      path: relPath,
      ...source,
      revisions: listHtmlMotionRevisions(storage, absPath),
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not read HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/patch', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifestPath, manifest } = readHtmlMotionManifest(storage, absPath);
    const sourceHtml = fs.readFileSync(absPath, 'utf-8');
    const revision = saveHtmlMotionRevision(storage, absPath, manifestPath, String(req.body?.reason || 'pre-patch checkpoint'));
    const patch = applyHtmlMotionPatchOperations(storage, sourceHtml, manifest, Array.isArray(req.body?.ops) ? req.body.ops : []);
    const nowIso = new Date().toISOString();
    let nextManifest = {
      ...patch.manifest,
      updatedAt: nowIso,
      htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
      revisionCount: listHtmlMotionRevisions(storage, absPath).length,
    };
    nextManifest = normalizeHtmlMotionManifestAssets(storage, nextManifest);
    Object.assign(nextManifest, buildHtmlMotionCompositionMetadata(patch.html, nextManifest));
    fs.writeFileSync(absPath, patch.html, 'utf-8');
    fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf-8');
    const clip = buildHtmlMotionClipEntry(storage, absPath, manifestPath, nextManifest);
    _broadcastWS({
      type: 'creative_html_motion_clip_saved',
      sessionId,
      creativeMode: 'video',
      clip,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      clip,
      appliedOps: patch.applied,
      revision,
      source: buildHtmlMotionSourcePayload(storage, absPath, manifestPath, nextManifest, {
        includeHtml: req.body?.includeHtml === true,
      }),
      revisions: listHtmlMotionRevisions(storage, absPath),
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      nextSelfReview: 'Run creative_render_html_motion_snapshot at early/mid/near-end frames before exporting.',
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not patch HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/restore', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  const revisionId = String(req.body?.revisionId || req.body?.id || '').trim();
  if (!targetPath || !revisionId) {
    res.status(400).json({ success: false, error: 'path and revisionId are required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifestPath } = readHtmlMotionManifest(storage, absPath);
    const safeRevisionId = revisionId.replace(/[^a-z0-9_.-]+/gi, '');
    if (!safeRevisionId || safeRevisionId !== revisionId) throw new Error('Invalid revisionId.');
    const revisionDir = getHtmlMotionRevisionDir(storage, absPath);
    const revisionHtmlPath = path.join(revisionDir, `${safeRevisionId}.html`);
    const revisionManifestPath = path.join(revisionDir, `${safeRevisionId}.json`);
    if (!isPathInside(revisionDir, revisionHtmlPath) || !fs.existsSync(revisionHtmlPath)) {
      res.status(404).json({ success: false, error: 'HTML motion revision not found.' });
      return;
    }
    const rollbackRevision = saveHtmlMotionRevision(storage, absPath, manifestPath, `before restore ${safeRevisionId}`);
    fs.copyFileSync(revisionHtmlPath, absPath);
    let restoredManifest: any = {};
    if (fs.existsSync(revisionManifestPath)) {
      try {
        restoredManifest = JSON.parse(fs.readFileSync(revisionManifestPath, 'utf-8'));
      } catch {
        restoredManifest = {};
      }
    }
    const nowIso = new Date().toISOString();
    const nextManifest = {
      ...restoredManifest,
      updatedAt: nowIso,
      restoredFromRevision: safeRevisionId,
      htmlPath: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
    };
    Object.assign(nextManifest, buildHtmlMotionCompositionMetadata(fs.readFileSync(absPath, 'utf-8'), nextManifest));
    fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf-8');
    const clip = buildHtmlMotionClipEntry(storage, absPath, manifestPath, nextManifest);
    _broadcastWS({
      type: 'creative_html_motion_clip_saved',
      sessionId,
      creativeMode: 'video',
      clip,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      clip,
      restoredRevisionId: safeRevisionId,
      rollbackRevision,
      source: buildHtmlMotionSourcePayload(storage, absPath, manifestPath, nextManifest, {
        includeHtml: req.body?.includeHtml === true,
      }),
      revisions: listHtmlMotionRevisions(storage, absPath),
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      nextSelfReview: 'Run creative_render_html_motion_snapshot at early/mid/near-end frames before exporting.',
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not restore HTML motion revision');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/html-motion-clip/preview', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.query?.path || '').trim();
  if (!targetPath) {
    res.status(400).send('path query param required');
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.query?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const html = renderHtmlMotionClipHtml(storage, absPath, manifest, {
      sessionId,
      root: String(req.query?.root || '').trim(),
      absoluteUrls: false,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err: any) {
    const message = String(err?.message || 'Could not preview HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).send(message);
  }
});

router.get('/api/canvas/html-motion-clip/asset', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.query?.path || '').trim();
  const assetId = sanitizeHtmlMotionAssetId(req.query?.asset || '');
  if (!targetPath || !assetId) {
    res.status(400).send('path and asset query params required');
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.query?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const asset = (Array.isArray(manifest.assets) ? manifest.assets : []).find((candidate: any) => sanitizeHtmlMotionAssetId(candidate?.id || '') === assetId);
    if (!asset) {
      res.status(404).send('HTML motion asset not found.');
      return;
    }
    if (asset.dataUrl) {
      const match = String(asset.dataUrl).match(/^data:([^;,]+).*?;base64,(.*)$/i);
      if (!match) {
        res.status(400).send('Invalid data URL asset.');
        return;
      }
      res.setHeader('Content-Type', match[1] || asset.mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(match[2] || '', 'base64'));
      return;
    }
    if (asset.url) {
      res.redirect(String(asset.url));
      return;
    }
    const sourcePath = String(asset.absPath || asset.path || asset.source || '').trim();
    const { absPath: assetAbsPath } = resolveCanvasPath(sourcePath);
    if (!fs.existsSync(assetAbsPath) || !fs.statSync(assetAbsPath).isFile()) {
      res.status(404).send('HTML motion asset file not found.');
      return;
    }
    res.setHeader('Content-Type', asset.mimeType || guessContentType(assetAbsPath));
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(assetAbsPath);
  } catch (err: any) {
    const message = String(err?.message || 'Could not serve HTML motion asset');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).send(message);
  }
});

router.post('/api/canvas/html-motion-clip/lint', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const html = typeof req.body?.html === 'string' ? String(req.body.html) : '';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  try {
    if (html) {
      const manifest = req.body?.manifest && typeof req.body.manifest === 'object' ? req.body.manifest : req.body;
      res.json({ success: true, ...lintHtmlMotionComposition(html, manifest) });
      return;
    }
    if (!targetPath) {
      res.status(400).json({ success: false, error: 'html or path is required' });
      return;
    }
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath, relPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const lint = lintHtmlMotionComposition(fs.readFileSync(absPath, 'utf-8'), manifest);
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      path: relPath,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      ...lint,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not lint HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/inspect', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const html = typeof req.body?.html === 'string' ? String(req.body.html) : '';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    let lint: ReturnType<typeof lintHtmlMotionComposition>;
    let previewUrl = '';
    let relPath = '';
    let absPath = '';
    let manifest: any = {};
    if (targetPath) {
      const resolved = resolveHtmlMotionClipFile(storage, targetPath);
      absPath = resolved.absPath;
      relPath = resolved.relPath;
      manifest = readHtmlMotionManifest(storage, absPath).manifest;
      lint = lintHtmlMotionComposition(fs.readFileSync(absPath, 'utf-8'), manifest);
      const params = new URLSearchParams({
        sessionId,
        path: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
        root: String(req.body?.root || '').trim(),
      });
      const token = resolveGatewayAuthToken();
      if (token) params.set('token', token);
      previewUrl = `${getGatewayBaseUrl()}/api/canvas/html-motion-clip/preview?${params.toString()}`;
    } else if (html) {
      manifest = req.body?.manifest && typeof req.body.manifest === 'object' ? req.body.manifest : req.body;
      lint = lintHtmlMotionComposition(html, manifest);
      previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    } else {
      res.status(400).json({ success: false, error: 'path or html is required' });
      return;
    }
    const width = Math.max(320, Number(req.body?.width) || Number(manifest.width) || Number(lint.composition.width) || 1080);
    const height = Math.max(320, Number(req.body?.height) || Number(manifest.height) || Number(lint.composition.height) || 1920);
    const durationMs = Math.max(1000, Number(req.body?.durationMs) || Number(manifest.durationMs) || Number(lint.composition.durationMs) || 8000);
    const sampleTimesMs = Array.isArray(req.body?.sampleTimesMs) && req.body.sampleTimesMs.length
      ? req.body.sampleTimesMs.map((value: any) => Math.max(0, Math.round(Number(value) || 0)))
      : buildHtmlMotionQaSampleTimes(durationMs, lint.composition);
    const inspect = await inspectHtmlMotionPage({
      url: previewUrl,
      width,
      height,
      durationMs,
      sampleTimesMs,
      perFrameTimeoutMs: Math.max(1000, Number(req.body?.perFrameTimeoutMs) || 8000),
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      path: relPath || null,
      absPath: absPath || null,
      renderer: 'html-motion',
      audio: 'visual-only',
      qa: {
        lint: lint.ok ? 'passed' : 'failed',
        textFit: lint.textFit?.ok === false ? 'failed' : 'passed',
        spatial: inspect.issues.some((issue: any) => String(issue?.code || '').startsWith('spatial-') && issue?.severity === 'error') ? 'failed' : 'passed',
        snapshots: inspect.ok ? 'passed' : 'failed',
      },
      lint,
      inspect,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/html-motion-adapters', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  res.json({
    success: true,
    adapters: listHtmlMotionAdapterSnippets({
      category: String(req.query?.category || '').trim(),
      query: String(req.query?.q || req.query?.query || '').trim(),
    }),
  });
});

router.get('/api/canvas/html-motion-blocks', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  res.json({
    success: true,
    blocks: listHtmlMotionBlocks({
      category: String(req.query?.category || ''),
      query: String(req.query?.query || ''),
      packId: String(req.query?.packId || ''),
    }),
  });
});

router.post('/api/canvas/html-motion-blocks/render', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  try {
    const blockId = String(req.body?.blockId || req.body?.id || '').trim();
    if (!blockId) {
      res.status(400).json({ success: false, error: 'blockId is required' });
      return;
    }
    const rendered = renderHtmlMotionBlock(blockId, req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {});
    res.json({ success: true, ...rendered });
  } catch (err: any) {
    res.status(400).json({ success: false, error: String(err?.message || 'Could not render HTML motion block') });
  }
});

router.get('/api/canvas/html-motion-templates', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (_req: any, res: any) => {
  const templates = summarizeHtmlMotionTemplates();
  res.json({
    success: true,
    templates,
    count: templates.length,
    usage: 'Pick a template id, then call creative_apply_html_motion_template with templateId and concrete input values.',
  });
});

router.post('/api/canvas/html-motion-templates/apply', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  try {
    const templateId = String(req.body?.templateId || req.body?.id || '').trim();
    if (!templateId) {
      res.status(400).json({ success: false, error: 'templateId is required' });
      return;
    }
    const inputSource = req.body?.input && typeof req.body.input === 'object' ? req.body.input : req.body?.inputs;
    const input = inputSource && typeof inputSource === 'object' ? inputSource : {};
    const rendered = applyHtmlMotionTemplate(templateId, input);
    const lint = lintHtmlMotionComposition(rendered.html, {
      kind: 'prometheus-html-motion-template-preview',
      templateId,
      width: rendered.width,
      height: rendered.height,
      durationMs: rendered.durationMs,
      frameRate: rendered.frameRate,
    });
    res.json({ success: true, ...rendered, lint, composition: lint.composition });
  } catch (err: any) {
    res.status(400).json({ success: false, error: String(err?.message || 'Could not apply HTML motion template') });
  }
});

router.post('/api/canvas/html-motion-clip/snapshot', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath, relPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const lint = lintHtmlMotionComposition(fs.readFileSync(absPath, 'utf-8'), manifest);
    const width = Math.max(320, Number(req.body?.width) || Number(manifest.width) || 1080);
    const height = Math.max(320, Number(req.body?.height) || Number(manifest.height) || 1920);
    const durationMs = Math.max(1000, Number(req.body?.durationMs) || Number(manifest.durationMs) || 8000);
    const sampleTimesMs = (Array.isArray(req.body?.sampleTimesMs) && req.body.sampleTimesMs.length ? req.body.sampleTimesMs : [
      Number.isFinite(Number(req.body?.atMs)) ? Number(req.body.atMs) : 500,
      Math.round(durationMs / 2),
      Math.max(0, durationMs - 500),
    ].filter((value: any) => Number.isFinite(Number(value))))
      .map((value: any) => Math.max(0, Math.min(durationMs, Math.round(Number(value) || 0))))
      .slice(0, 12);
    const params = new URLSearchParams({
      sessionId,
      path: relPath,
      root: String(req.body?.root || '').trim(),
    });
    const token = resolveGatewayAuthToken();
    if (token) params.set('token', token);
    const frames = await captureHtmlMotionFrames({
      url: `${getGatewayBaseUrl()}/api/canvas/html-motion-clip/preview?${params.toString()}`,
      width,
      height,
      sampleTimesMs,
      includeDataUrl: req.body?.includeDataUrl !== false,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      path: relPath,
      width,
      height,
      durationMs,
      sampleCount: frames.length,
      frames,
      lint,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not render HTML motion snapshot');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/export', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const lint = lintHtmlMotionComposition(fs.readFileSync(absPath, 'utf-8'), manifest);
    if (!lint.ok && req.body?.force !== true) {
      res.status(400).json({
        success: false,
        error: 'HTML motion lint failed. Pass force=true only if you intentionally want to export despite blockers.',
        lint,
      });
      return;
    }
    const width = Math.max(320, Number(req.body?.width) || Number(manifest.width) || 1080);
    const height = Math.max(320, Number(req.body?.height) || Number(manifest.height) || 1920);
    const durationMs = Math.max(1000, Number(req.body?.durationMs) || Number(manifest.durationMs) || 8000);
    const requestedFrameRate = Number(req.body?.frameRate) || Number(manifest.frameRate) || Number(lint.composition.frameRate) || 30;
    const frameRate = Math.max(1, Math.min(req.body?.forceHighFps === true ? 60 : 30, requestedFrameRate));
    const maxFrames = Math.max(24, Math.min(1800, Number(req.body?.maxFrames) || 720));
    const audioAttachment = resolveHtmlMotionAudioAttachment(storage, manifest, req.body || {});
    if (!(await hasCreativeFfmpeg())) {
      res.status(500).json({ success: false, error: 'ffmpeg is required for HTML motion MP4 export.' });
      return;
    }
    const renderId = `html_motion_export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const tempDir = path.join(getHtmlMotionDir(storage), 'exports', renderId);
    fs.mkdirSync(tempDir, { recursive: true });
    const outputFilename = sanitizeCreativeAssetFilename(req.body?.filename, `${renderId}.mp4`).replace(/\.[^.]+$/i, '') || renderId;
    const outputPath = path.join(storage.exportsDir, `${outputFilename}.mp4`);
    const sourceRelPath = buildCreativeStorageRelativePath(storage.workspacePath, absPath);
    const params = new URLSearchParams({
      sessionId,
      path: sourceRelPath,
      root: String(req.body?.root || '').trim(),
    });
    const token = resolveGatewayAuthToken();
    if (token) params.set('token', token);
    let preExportInspect: Awaited<ReturnType<typeof inspectHtmlMotionPage>> | null = null;
    const previewUrl = `${getGatewayBaseUrl()}/api/canvas/html-motion-clip/preview?${params.toString()}`;
    if (req.body?.skipSpatialQa !== true) {
      const qaSamples = buildHtmlMotionQaSampleTimes(durationMs, lint.composition);
      preExportInspect = await inspectHtmlMotionPage({
        url: previewUrl,
        width,
        height,
        durationMs,
        sampleTimesMs: qaSamples,
        perFrameTimeoutMs: Math.max(1000, Number(req.body?.perFrameTimeoutMs) || 8000),
      });
      if (!preExportInspect.ok && req.body?.force !== true) {
        res.status(400).json({
          success: false,
          error: 'HTML motion spatial/text QA failed. Pass force=true only if you intentionally want to export despite blockers.',
          lint,
          inspect: preExportInspect,
        });
        return;
      }
    }
    let renderStats: { frameCount: number; encodedFrameRate: number; exactDuplicateFrameCount: number } | null = null;
    try {
      const frameRender = await renderHtmlMotionVideoFrames({
        url: previewUrl,
        width,
        height,
        durationMs,
        frameRate,
        tempDir,
        maxFrames,
        onProgress: (progress) => {
          _broadcastWS({
            type: 'creative_html_motion_export_progress',
            sessionId,
            creativeMode: 'video',
            phase: progress.phase,
            frame: progress.index,
            totalFrames: progress.total,
            atMs: progress.atMs,
            percent: Math.round((progress.index / Math.max(1, progress.total)) * 85),
          });
        },
      });
      renderStats = {
        frameCount: frameRender.frameCount,
        encodedFrameRate: frameRender.encodedFrameRate,
        exactDuplicateFrameCount: frameRender.exactDuplicateFrameCount,
      };
      _broadcastWS({
        type: 'creative_html_motion_export_progress',
        sessionId,
        creativeMode: 'video',
        phase: 'encode',
        frame: frameRender.frameCount,
        totalFrames: frameRender.frameCount,
        percent: 90,
      });
      const ffmpegArgs = [
        '-y',
        '-framerate', String(frameRender.encodedFrameRate),
        '-i', frameRender.framePattern,
      ];
      if (audioAttachment) {
        if (audioAttachment.trimStartMs > 0) ffmpegArgs.push('-ss', (audioAttachment.trimStartMs / 1000).toFixed(3));
        ffmpegArgs.push('-i', audioAttachment.sourcePath);
      }
      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
      );
      if (audioAttachment) {
        ffmpegArgs.push(
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-t', (durationMs / 1000).toFixed(3),
          '-shortest',
        );
      }
      ffmpegArgs.push(
        '-movflags', '+faststart',
        outputPath,
      );
      await execFileAsync('ffmpeg', ffmpegArgs, {
        windowsHide: true,
        timeout: Math.max(60_000, Math.min(300_000, durationMs * 8)),
        maxBuffer: 1024 * 1024 * 32,
      });
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
    const stat = fs.statSync(outputPath);
    const artifact = {
      filename: path.basename(outputPath),
      path: buildCreativeStorageRelativePath(storage.workspacePath, outputPath),
      absPath: outputPath,
      mimeType: 'video/mp4',
      size: stat.size,
    };
    _broadcastWS({
      type: 'creative_export_saved',
      sessionId,
      creativeMode: 'video',
      path: artifact.path,
      absPath: artifact.absPath,
      mimeType: artifact.mimeType,
      size: artifact.size,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      renderer: 'html-motion',
      audio: audioAttachment ? 'muxed' : 'visual-only',
      export: artifact,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      source: {
        path: buildCreativeStorageRelativePath(storage.workspacePath, absPath),
        absPath,
        width,
        height,
        durationMs,
        frameRate,
      },
      render: {
        renderer: 'html-motion',
        audio: audioAttachment ? {
          status: 'muxed',
          source: buildCreativeStorageRelativePath(storage.workspacePath, audioAttachment.sourcePath),
          trimStartMs: audioAttachment.trimStartMs,
          label: audioAttachment.label,
        } : {
          status: 'visual-only',
        },
        strategy: 'deterministic-frame-sequence',
        expectedFrameCount: renderStats?.frameCount || Math.max(1, Math.ceil((durationMs / 1000) * frameRate)),
        requestedFrameRate,
        encodedFrameRate: renderStats?.encodedFrameRate || Math.max(1, Math.min(frameRate, Math.max(1, Math.floor((maxFrames * 1000) / durationMs)))),
        maxFrames,
        exactDuplicateFrameCount: renderStats?.exactDuplicateFrameCount ?? null,
      },
      qa: {
        lint: lint.ok ? 'passed' : 'failed',
        textFit: lint.textFit?.ok === false ? 'failed' : 'passed',
        spatial: preExportInspect ? (preExportInspect.ok ? 'passed' : 'failed') : 'skipped',
        snapshots: 'passed',
      },
      lint,
      inspect: preExportInspect,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not export HTML motion clip');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/html-motion-clip/export-folder', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const targetPath = String(req.body?.path || req.body?.htmlPath || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }
  try {
    const storage = resolveCreativeStorage(sessionId, String(req.body?.root || '').trim());
    const { absPath } = resolveHtmlMotionClipFile(storage, targetPath);
    const { manifest } = readHtmlMotionManifest(storage, absPath);
    const folderName = sanitizeCreativeAssetFilename(req.body?.folderName, `${path.basename(absPath, path.extname(absPath))}-standalone`).replace(/\.[^.]+$/i, '') || 'html-motion-standalone';
    const outputDir = path.join(storage.exportsDir, folderName);
    const result = writeStandaloneHtmlMotionExport({
      storage,
      htmlPath: absPath,
      manifest,
      outputDir,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: 'video',
      renderer: 'html-motion',
      audio: 'visual-only',
      qa: {
        lint: result.manifest.lint?.ok ? 'passed' : 'failed',
        textFit: result.manifest.lint?.textFit?.ok === false ? 'failed' : 'passed',
        snapshots: 'not-run',
      },
      export: {
        kind: 'standalone-folder',
        path: buildCreativeStorageRelativePath(storage.workspacePath, result.folder),
        absPath: result.folder,
        files: result.files,
      },
      manifest: result.manifest,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not export standalone HTML motion folder');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-assets', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.query?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const libraryPayload = buildCreativeLibraryPayload(storage, readCreativeLibraryRegistry(storage));
    const scenesBase = buildCreativeStorageRelativePath(storage.rootAbsPath, storage.scenesDir);
    const exportsBase = buildCreativeStorageRelativePath(storage.rootAbsPath, storage.exportsDir);
    const scenes = fs.existsSync(storage.scenesDir) ? buildWorkspaceTree(storage.scenesDir, scenesBase) : [];
    const exports = fs.existsSync(storage.exportsDir) ? buildWorkspaceTree(storage.exportsDir, exportsBase) : [];
    const sceneEntries = fs.existsSync(storage.scenesDir)
      ? collectCreativeAssetEntries(storage.scenesDir, storage.workspacePath, storage.rootAbsPath, 'scene')
      : [];
    const exportEntries = fs.existsSync(storage.exportsDir)
      ? collectCreativeAssetEntries(storage.exportsDir, storage.workspacePath, storage.rootAbsPath, 'export')
      : [];
    const renderJobEntries = collectCreativeRenderJobEntries(storage);
    const assetIndex = readCreativeAssetIndex(storage);
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      scenes,
      exports,
      sceneEntries,
      exportEntries,
      renderJobsDir: storage.renderJobsDir,
      renderJobsDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, storage.renderJobsDir),
      renderJobEntries,
      assetIndex,
      indexedAssets: assetIndex.assets,
      libraries: libraryPayload.libraries,
      customPacks: libraryPayload.customCatalog,
      enabledLibraryIds: libraryPayload.enabledLibraryIds,
      librariesDir: libraryPayload.librariesDir,
      librariesDirRelative: libraryPayload.librariesDirRelative,
      counts: {
        scenes: sceneEntries.length,
        exports: exportEntries.length,
        jobs: renderJobEntries.length,
        indexedAssets: assetIndex.assets.length,
      },
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect creative assets');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-asset-index', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.query?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const kinds = String(req.query?.kinds || req.query?.kind || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const assets = searchCreativeAssets(storage, {
      query: String(req.query?.query || '').trim(),
      kinds,
      tags: String(req.query?.tags || '').trim(),
      brandId: String(req.query?.brandId || '').trim() || null,
      limit: Math.max(1, Math.min(200, Number(req.query?.limit) || 50)),
    });
    const index = readCreativeAssetIndex(storage);
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      total: index.assets.length,
      assets,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not search creative asset index');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-assets/import', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.body?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const asset = await importCreativeAsset(storage, {
      source: String(req.body?.source || '').trim(),
      filename: String(req.body?.filename || '').trim() || undefined,
      tags: req.body?.tags,
      brandId: req.body?.brandId ? String(req.body.brandId) : null,
      license: isCreativePlainObject(req.body?.license) ? req.body.license : null,
      copy: req.body?.copy !== false,
    });
    _broadcastWS({
      type: 'creative_asset_index_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      action: 'import',
      asset,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({ success: true, sessionId, asset });
  } catch (err: any) {
    const message = String(err?.message || 'Could not import creative asset');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/required|not found/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-assets/analyze', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.body?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const asset = await analyzeCreativeAsset(storage, {
      source: String(req.body?.source || '').trim(),
      tags: req.body?.tags,
      brandId: req.body?.brandId ? String(req.body.brandId) : null,
      license: isCreativePlainObject(req.body?.license) ? req.body.license : null,
      force: req.body?.force === true,
      upsert: req.body?.upsert !== false,
    });
    _broadcastWS({
      type: 'creative_asset_index_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      action: 'analyze',
      asset,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({ success: true, sessionId, asset });
  } catch (err: any) {
    const message = String(err?.message || 'Could not analyze creative asset');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/required|not found/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-assets/generate', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.body?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const asset = await generateCreativeAssetPlaceholder(storage, {
      prompt: String(req.body?.prompt || '').trim(),
      width: Number(req.body?.width) || undefined,
      height: Number(req.body?.height) || undefined,
      kind: req.body?.kind === 'image' ? 'image' : 'svg',
      tags: req.body?.tags,
      brandId: req.body?.brandId ? String(req.body.brandId) : null,
    });
    _broadcastWS({
      type: 'creative_asset_index_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      action: 'generate',
      asset,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({ success: true, sessionId, asset });
  } catch (err: any) {
    const message = String(err?.message || 'Could not generate creative asset');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/requires|required/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-extract-layers', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.body?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const extraction = await extractCreativeLayers(storage, {
      source: String(req.body?.source || '').trim(),
      mode: req.body?.mode,
      prompt: req.body?.prompt ? String(req.body.prompt) : undefined,
      textEditable: req.body?.textEditable === true,
      extractObjects: req.body?.extractObjects !== false,
      preserveOriginal: req.body?.preserveOriginal !== false,
      copySource: req.body?.copySource !== false,
      maxTextLayers: Number(req.body?.maxTextLayers) || undefined,
      maxShapeLayers: Number(req.body?.maxShapeLayers) || undefined,
      useVision: req.body?.useVision !== false,
      useOcr: req.body?.useOcr === true,
      useSam: req.body?.useSam !== false,
      inpaintBackground: req.body?.inpaintBackground !== false,
      vectorTraceShapes: req.body?.vectorTraceShapes !== false,
    });
    _broadcastWS({
      type: 'creative_asset_index_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      action: 'extract_layers',
      asset: extraction.source,
      scenePath: extraction.scenePath,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      ...extraction,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not extract editable layers');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/required|not found|only supports|requires/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-refine-mask', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.body?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const source = String(req.body?.source || '').trim();
    if (!source) throw new Error('source required');
    const bbox = req.body?.bbox;
    if (!bbox || typeof bbox !== 'object') throw new Error('bbox required');
    const points = Array.isArray(req.body?.points)
      ? req.body.points
          .filter((p: any) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)))
          .map((p: any) => ({ x: Number(p.x), y: Number(p.y), positive: p.positive !== false }))
      : [];
    const result = await refineCreativeLayerCutout({
      storage,
      source,
      bbox: {
        x: Number(bbox.x) || 0,
        y: Number(bbox.y) || 0,
        width: Number(bbox.width) || 0,
        height: Number(bbox.height) || 0,
      },
      points,
      outputName: req.body?.outputName ? String(req.body.outputName) : undefined,
    });
    res.json({
      success: true,
      sessionId,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      ...result,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not refine layer mask');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/required|not found|not installed/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-model-status', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (_req: any, res: any) => {
  try {
    res.json({ success: true, models: listCreativeModelStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || 'Could not list creative models') });
  }
});

router.get('/api/canvas/creative-audio-analysis', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const source = String(req.query?.source || '').trim();
  if (!source) {
    res.status(400).json({ success: false, error: 'source query param required' });
    return;
  }
  try {
    const requestedRoot = String(req.query?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const track = await enrichCreativeAudioTrack(storage, {
      source,
      label: String(req.query?.label || ''),
    }, {
      resolveLocalPath: (rawSource) => resolveCreativeAudioSourcePath(storage, rawSource),
      forceAnalysis: req.query?.force === '1' || req.query?.force === 'true',
      bucketCount: Math.max(24, Math.min(1024, Number(req.query?.bucketCount) || 240)),
    });
    res.json({
      success: true,
      sessionId,
      source,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      track,
      analysis: track.analysis,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not analyze creative audio source');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-motion-templates', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  try {
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      ...getCreativeMotionCatalog(),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect creative motion templates');
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-templates', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  try {
    const templates = listCreativePremiumTemplates();
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      templates,
      counts: { templates: templates.length },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err || 'Failed to list Creative templates.') });
  }
});

router.get('/api/canvas/creative-templates/:templateId', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  try {
    const template = getCreativePremiumTemplate(req.params?.templateId);
    if (!template) {
      res.status(404).json({ success: false, error: 'Unknown Creative template.' });
      return;
    }
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      template,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err || 'Failed to read Creative template.') });
  }
});

router.post('/api/canvas/creative-motion-preview', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const prepared = prepareCreativeMotionTemplate(req.body || {});
    const previewResult = await createCreativeMotionPreview(storage, prepared.input);
    const preview = previewResult.preview;
    const instance = { ...prepared.instance, preview };
    _broadcastWS({
      type: 'creative_motion_preview_created',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      templateId: prepared.input.templateId,
      presetId: prepared.input.presetId,
      preview,
      rendererError: previewResult.rendererError,
      validation: prepared.validation,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: prepared.validation.ok,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      template: prepared.template,
      input: prepared.input,
      instance,
      preview,
      fallback: previewResult.fallback,
      rendererError: previewResult.rendererError,
      validation: prepared.validation,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not create creative motion preview');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-motion-apply', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  try {
    const prepared = prepareCreativeMotionTemplate(req.body || {});
    res.json({
      success: prepared.validation.ok,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      template: prepared.template,
      input: prepared.input,
      instance: prepared.instance,
      validation: prepared.validation,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not prepare creative motion template');
    res.status(500).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-motion-variants', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  try {
    const templateId = String(req.body?.templateId || 'caption-reel').trim().toLowerCase();
    const catalog = getCreativeMotionCatalog();
    const template = catalog.templates.find((candidate: any) => candidate.id === templateId) || catalog.templates[0];
    const count = Math.max(1, Math.min(8, Number(req.body?.count) || Math.min(3, template?.presets?.length || 3)));
    const variants = (template?.presets || []).slice(0, count).map((preset: any, index: number) => {
      const prepared = prepareCreativeMotionTemplate({
        ...(req.body || {}),
        templateId: template.id,
        presetId: preset.id,
        style: {
          ...(preset.style || {}),
          ...(req.body?.style && typeof req.body.style === 'object' ? req.body.style : {}),
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
    res.json({
      success: true,
      sessionId,
      template,
      variants,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not generate creative motion variants');
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-libraries', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.query?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const payload = buildCreativeLibraryPayload(storage, readCreativeLibraryRegistry(storage));
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      librariesDir: payload.librariesDir,
      librariesDirRelative: payload.librariesDirRelative,
      libraries: payload.libraries,
      customPacks: payload.customCatalog,
      enabledLibraryIds: payload.enabledLibraryIds,
      registry: payload.registry,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect creative libraries');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-libraries', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const libraryId = sanitizeCreativeLibraryId(String(req.body?.libraryId || '').trim());
  const enabled = req.body?.enabled !== false;
  if (!libraryId) {
    res.status(400).json({ success: false, error: 'libraryId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const nowIso = new Date().toISOString();
    const registry = readCreativeLibraryRegistry(storage);
    const existingPayload = buildCreativeLibraryPayload(storage, registry);
    const targetPack = existingPayload.libraries.find((pack) => pack.id === libraryId);
    if (!targetPack) {
      res.status(404).json({ success: false, error: `Unknown creative library pack: ${libraryId}` });
      return;
    }
    registry.libraries = registry.libraries && typeof registry.libraries === 'object' ? registry.libraries : {};
    const existing = registry.libraries[libraryId];
    registry.libraries[libraryId] = {
      enabled,
      source: targetPack.source === 'custom' ? 'custom' : 'builtin',
      installedAt: typeof existing?.installedAt === 'string' ? existing.installedAt : nowIso,
      updatedAt: nowIso,
      manifestPath: targetPack.source === 'custom' ? targetPack.manifestPath || null : null,
      manifestPathRelative: targetPack.source === 'custom' ? targetPack.manifestPathRelative || null : null,
      sourceUrl: targetPack.source === 'custom' ? targetPack.sourceUrl || null : null,
    };
    writeCreativeLibraryRegistry(storage, registry);
    const payload = buildCreativeLibraryPayload(storage, registry);
    _broadcastWS({
      type: 'creative_library_registry_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      libraryId,
      enabled,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      enabledLibraryIds: payload.enabledLibraryIds,
    });
    res.json({
      success: true,
      sessionId,
      libraryId,
      enabled,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      librariesDir: payload.librariesDir,
      librariesDirRelative: payload.librariesDirRelative,
      libraries: payload.libraries,
      customPacks: payload.customCatalog,
      enabledLibraryIds: payload.enabledLibraryIds,
      registry: payload.registry,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not update creative library pack');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-libraries/import', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const enabled = req.body?.enabled !== false;
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const { manifest, sourceUrl } = await resolveCreativeLibraryImportManifest(req.body);
    const normalizedPack = normalizeCustomCreativeLibraryManifest(manifest, storage, { sourceUrl });
    const manifestInfo = writeCustomCreativeLibraryPack(storage, normalizedPack);
    const nowIso = new Date().toISOString();
    const registry = readCreativeLibraryRegistry(storage);
    registry.libraries = registry.libraries && typeof registry.libraries === 'object' ? registry.libraries : {};
    const existing = registry.libraries[normalizedPack.id];
    registry.libraries[normalizedPack.id] = {
      enabled,
      source: 'custom',
      installedAt: typeof existing?.installedAt === 'string' ? existing.installedAt : nowIso,
      updatedAt: nowIso,
      manifestPath: manifestInfo.manifestPath,
      manifestPathRelative: manifestInfo.manifestPathRelative,
      sourceUrl: sourceUrl || normalizedPack.sourceUrl || null,
    };
    writeCreativeLibraryRegistry(storage, registry);
    const payload = buildCreativeLibraryPayload(storage, registry);
    _broadcastWS({
      type: 'creative_library_registry_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      libraryId: normalizedPack.id,
      enabled,
      source: 'custom',
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      enabledLibraryIds: payload.enabledLibraryIds,
    });
    res.json({
      success: true,
      sessionId,
      importedLibraryId: normalizedPack.id,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      librariesDir: payload.librariesDir,
      librariesDirRelative: payload.librariesDirRelative,
      libraries: payload.libraries,
      customPacks: payload.customCatalog,
      enabledLibraryIds: payload.enabledLibraryIds,
      registry: payload.registry,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not import creative library pack');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
});

router.delete('/api/canvas/creative-libraries/:libraryId', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || req.body?.sessionId || 'default').trim() || 'default';
  const libraryId = sanitizeCreativeLibraryId(String(req.params?.libraryId || '').trim(), '');
  if (!libraryId) {
    res.status(400).json({ success: false, error: 'libraryId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.query?.root || req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const registry = readCreativeLibraryRegistry(storage);
    const payloadBefore = buildCreativeLibraryPayload(storage, registry);
    const targetPack = payloadBefore.customCatalog.find((pack) => pack.id === libraryId);
    if (!targetPack) {
      res.status(404).json({ success: false, error: `Custom creative library pack not found: ${libraryId}` });
      return;
    }
    const manifestAbsPath = getCustomCreativeLibraryManifestFilePath(storage, libraryId);
    if (fs.existsSync(manifestAbsPath)) {
      fs.unlinkSync(manifestAbsPath);
    }
    registry.libraries = registry.libraries && typeof registry.libraries === 'object' ? registry.libraries : {};
    delete registry.libraries[libraryId];
    writeCreativeLibraryRegistry(storage, registry);
    const payload = buildCreativeLibraryPayload(storage, registry);
    _broadcastWS({
      type: 'creative_library_registry_updated',
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      libraryId,
      removed: true,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      enabledLibraryIds: payload.enabledLibraryIds,
    });
    res.json({
      success: true,
      sessionId,
      removedLibraryId: libraryId,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      librariesDir: payload.librariesDir,
      librariesDirRelative: payload.librariesDirRelative,
      libraries: payload.libraries,
      customPacks: payload.customCatalog,
      enabledLibraryIds: payload.enabledLibraryIds,
      registry: payload.registry,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not remove creative library pack');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-render-jobs', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const requestedRoot = String(req.query?.root || '').trim();
  try {
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const renderJobEntries = collectCreativeRenderJobEntries(storage);
    res.json({
      success: true,
      sessionId,
      creativeMode: getCreativeMode(sessionId) || null,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      renderJobsDir: storage.renderJobsDir,
      renderJobsDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, storage.renderJobsDir),
      renderJobEntries,
      counts: {
        jobs: renderJobEntries.length,
      },
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect creative render jobs');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-render-jobs', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const modeRaw = String(req.body?.mode || getCreativeMode(sessionId) || 'canvas').trim().toLowerCase();
    const creativeMode = modeRaw === 'video' ? 'video' : (modeRaw === 'design' ? 'design' : 'canvas');
    const format = normalizeCreativeRenderFormat(req.body?.format, 'render');
    const now = new Date().toISOString();
    const id = sanitizeCreativeRenderJobId(req.body?.id, generateCreativeRenderJobId());
    const normalizedSceneDoc = await normalizeCreativeSceneDocForStorage(storage, isPlainObject(req.body?.doc) ? req.body.doc : {}, {
      forceAudioAnalysis: false,
    });
    const record: CreativeRenderJobRecord = normalizeCreativeRenderJobRecord({
      kind: 'prometheus-creative-render-job',
      version: 2,
      id,
      sessionId,
      creativeMode,
      format,
      renderer: String(req.body?.renderer || 'browser-hybrid').trim() || 'browser-hybrid',
      requestedAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      status: normalizeCreativeRenderJobStatusValue(req.body?.status, 'queued'),
      progress: 0,
      progressLabel: req.body?.progressLabel ? String(req.body.progressLabel) : 'Queued for export',
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      summary: isCreativePlainObject(req.body?.summary)
        ? creativeCloneData(req.body.summary)
        : summarizeNormalizedCreativeSceneDoc(normalizedSceneDoc),
      sceneDoc: normalizedSceneDoc,
      exportOptions: normalizeCreativeRenderExportOptions(req.body?.exportOptions, normalizedSceneDoc),
      metadata: isCreativePlainObject(req.body?.metadata) ? creativeCloneData(req.body.metadata) : null,
      cancelRequested: false,
      error: null,
      lastError: null,
      errorHistory: [],
      attemptCount: 0,
      maxAttempts: Number(req.body?.maxAttempts) > 0 ? Math.max(1, Number(req.body.maxAttempts)) : 2,
      retryable: req.body?.retryable !== false,
      workerToken: null,
      output: null,
    }) as CreativeRenderJobRecord;
    if (record.renderer === 'server-browser' && record.format === 'mp4') {
      const ffmpegAvailable = await hasCreativeFfmpeg();
      record.metadata = {
        ...(record.metadata || {}),
        serverFinishRequested: true,
        serverFinishPreferred: true,
        serverFinishTool: 'ffmpeg',
        serverFinishToolAvailable: ffmpegAvailable,
        sourceFormat: 'webm',
        outputFormat: 'mp4',
        outputMimeType: 'video/mp4',
      };
      if (!ffmpegAvailable) {
        const warnings = Array.isArray(record.preflight?.warnings) ? record.preflight.warnings.slice() : [];
        if (!warnings.includes('FFmpeg is unavailable, so MP4 server finishing may fall back to the source capture format.')) {
          warnings.push('FFmpeg is unavailable, so MP4 server finishing may fall back to the source capture format.');
        }
        record.preflight = {
          ...record.preflight,
          status: record.preflight?.status === 'blocked' ? 'blocked' : 'warning',
          warnings,
        };
      }
    }
    record.retryable = record.retryable === true
      && record.preflight?.requiresServerWorker === true
      && record.preflight?.serverExportPossible === true
      && record.preflight?.status !== 'blocked';
    const { entry } = writeCreativeRenderJobRecord(storage, record);
    _broadcastWS({
      type: 'creative_render_job_updated',
      sessionId,
      creativeMode,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      renderJobsDir: storage.renderJobsDir,
      renderJobsDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, storage.renderJobsDir),
      created: true,
      terminal: false,
      exportSaved: false,
      job: entry,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      renderJobsDir: storage.renderJobsDir,
      renderJobsDirRelative: buildCreativeStorageRelativePath(storage.workspacePath, storage.renderJobsDir),
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, getCreativeRenderJobFilePath(storage, record.id), record, { includePayload: true }),
    });
    if (String(req.body?.renderer || '').trim() === 'server-browser' && req.body?.autoStart === true) {
      void startCreativeRenderWorker(storage, record.id);
    }
  } catch (err: any) {
    const message = String(err?.message || 'Could not create creative render job');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-render-jobs/:jobId/start', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const jobId = sanitizeCreativeRenderJobId(req.params?.jobId, '');
  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const { absPath, record } = readCreativeRenderJobRecord(storage, jobId);
    if (!isCreativeRenderJobTerminal(record.status)) {
      record.updatedAt = new Date().toISOString();
      record.progressLabel = record.progressLabel || 'Queued for server render';
      writeCreativeRenderJobRecord(storage, record);
      void startCreativeRenderWorker(storage, jobId);
    }
    res.json({
      success: true,
      sessionId,
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, absPath, record),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not start creative render job');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-render-jobs/:jobId', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default').trim() || 'default';
  const jobId = sanitizeCreativeRenderJobId(req.params?.jobId, '');
  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.query?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const { absPath, record } = readCreativeRenderJobRecord(storage, jobId);
    res.json({
      success: true,
      sessionId,
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, absPath, record, { includePayload: true }),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not inspect creative render job');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-render-jobs/:jobId/progress', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const jobId = sanitizeCreativeRenderJobId(req.params?.jobId, '');
  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    let record = readCreativeRenderJobRecord(storage, jobId).record;
    const now = new Date().toISOString();
    const nextStatus = normalizeCreativeRenderJobStatusValue(req.body?.status, record.status);
    record.status = nextStatus;
    record.updatedAt = now;
    if (!record.startedAt && (nextStatus === 'running' || nextStatus === 'uploading')) {
      record.startedAt = now;
    }
    if (req.body?.progress !== undefined) {
      record.progress = creativeClampNumber(Number(req.body.progress) || 0, 0, 1);
    }
    if (req.body?.progressLabel !== undefined) {
      record.progressLabel = req.body.progressLabel ? String(req.body.progressLabel) : null;
    }
    if (req.body?.cancelRequested !== undefined) {
      record.cancelRequested = req.body.cancelRequested === true;
    }
    if (req.body?.error !== undefined) {
      record.error = req.body.error ? String(req.body.error) : null;
      if (record.error) {
        record = appendCreativeRenderJobError(record as any, record.error, 'progress') as any;
      }
    }
    if (isCreativePlainObject(req.body?.metadata)) {
      record.metadata = { ...(record.metadata || {}), ...creativeCloneData(req.body.metadata) };
    }
    if (isNormalizedCreativeRenderJobTerminal(nextStatus)) {
      record.finishedAt = now;
      if (nextStatus === 'completed') record.progress = 1;
    } else {
      record.finishedAt = null;
    }
    broadcastCreativeRenderJobUpdate(storage, record);
    res.json({
      success: true,
      sessionId,
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, getCreativeRenderJobFilePath(storage, record.id), record),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not update creative render job');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-render-jobs/:jobId/cancel', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const jobId = sanitizeCreativeRenderJobId(req.params?.jobId, '');
  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const { record } = readCreativeRenderJobRecord(storage, jobId);
    record.updatedAt = new Date().toISOString();
    record.cancelRequested = true;
    if (!isCreativeRenderJobTerminal(record.status)) {
      record.status = 'cancel_requested';
      record.progressLabel = 'Cancellation requested';
    }
    broadcastCreativeRenderJobUpdate(storage, record);
    res.json({
      success: true,
      sessionId,
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, getCreativeRenderJobFilePath(storage, record.id), record),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not cancel creative render job');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-render-jobs/:jobId/complete', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const jobId = sanitizeCreativeRenderJobId(req.params?.jobId, '');
  const rawBase64 = String(req.body?.base64 || '').trim();
  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId is required' });
    return;
  }
  if (!rawBase64) {
    res.status(400).json({ success: false, error: 'base64 is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const { record } = readCreativeRenderJobRecord(storage, jobId);
    const finalizedArtifact = await maybeFinalizeCreativeRenderArtifact(storage, record, {
      rawBase64,
      mimeType: String(req.body?.mimeType || 'application/octet-stream').trim(),
      filename: req.body?.filename || `${record.id}${extensionForMimeType(String(req.body?.mimeType || '').trim()) || '.bin'}`,
      relativePath: req.body?.relativePath,
    });
    const exportArtifact = finalizedArtifact.artifact;
    const now = new Date().toISOString();
    record.updatedAt = now;
    record.finishedAt = now;
    record.startedAt = record.startedAt || now;
    record.status = 'completed';
    record.progress = 1;
    record.progressLabel = 'Completed';
    record.cancelRequested = false;
    record.error = null;
    record.lastError = null;
    if (isCreativePlainObject(req.body?.metadata)) {
      record.metadata = { ...(record.metadata || {}), ...creativeCloneData(req.body.metadata) };
    }
    record.metadata = {
      ...(record.metadata || {}),
      ...creativeCloneData(finalizedArtifact.metadata || {}),
    };
    record.output = {
      filename: exportArtifact.filename,
      path: exportArtifact.path,
      absPath: exportArtifact.absPath,
      mimeType: exportArtifact.mimeType,
      size: exportArtifact.size,
    };
    broadcastCreativeRenderJobUpdate(storage, record, { exportSaved: true });
    _broadcastWS({
      type: 'creative_export_saved',
      sessionId,
      creativeMode: record.creativeMode || null,
      path: exportArtifact.path,
      absPath: exportArtifact.absPath,
      mimeType: exportArtifact.mimeType,
      size: exportArtifact.size,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode: record.creativeMode || null,
      filename: exportArtifact.filename,
      path: exportArtifact.path,
      absPath: exportArtifact.absPath,
      mimeType: exportArtifact.mimeType,
      size: exportArtifact.size,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      job: buildCreativeRenderJobEntry(storage.workspacePath, storage.rootAbsPath, getCreativeRenderJobFilePath(storage, record.id), record),
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not finalize creative render job');
    const status = /not found/i.test(message) ? 404 : (/outside workspace|allowed/i.test(message) ? 403 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/api/canvas/creative-scene', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const targetPath = String(req.query?.path || '').trim();
  if (!targetPath) {
    res.status(400).json({ success: false, error: 'path query param required' });
    return;
  }
  try {
    const { absPath, relPath } = resolveCanvasPath(targetPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.status(404).json({ success: false, error: 'Creative scene not found.' });
      return;
    }
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const envelope = normalizeCreativeSceneEnvelope(parsed, {
      savedAt: parsed?.savedAt,
      sessionId: parsed?.sessionId,
      creativeMode: parsed?.creativeMode || null,
      storageRoot: parsed?.storageRoot || null,
    });
    const doc = await normalizeCreativeSceneDocForStorage(
      resolveCreativeStorage(String(parsed?.sessionId || req.query?.sessionId || 'default').trim() || 'default', req.query?.root ? String(req.query.root).trim() : ''),
      envelope.doc,
      { forceAudioAnalysis: false },
    ).catch(() => envelope.doc);
    res.json({
      success: true,
      path: relPath,
      absPath,
      doc,
      meta: {
        kind: envelope.kind,
        version: envelope.version,
        savedAt: envelope.savedAt,
        creativeMode: envelope.creativeMode || null,
        summary: envelope.summary || null,
        storageRoot: envelope.storageRoot || null,
      },
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not read creative scene');
    const status = /outside workspace|allowed/i.test(message) ? 403 : (/Unexpected token|JSON/i.test(message) ? 400 : 500);
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-scene', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const doc = req.body?.doc;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    res.status(400).json({ success: false, error: 'doc must be an object' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const modeRaw = String(req.body?.mode || getCreativeMode(sessionId) || 'canvas').trim().toLowerCase();
    const creativeMode = modeRaw === 'video' ? 'video' : (modeRaw === 'design' ? 'design' : 'canvas');
    const filename = sanitizeCreativeSceneFilename(req.body?.filename, `${creativeMode}-scene.json`);
    const relativePath = sanitizeRelativeUploadPath(String(req.body?.relativePath || '').trim());
    let targetPath = relativePath
      ? path.resolve(storage.scenesDir, relativePath)
      : path.join(storage.scenesDir, filename);
    if (path.extname(targetPath).toLowerCase() !== '.json') {
      targetPath = `${targetPath}.json`;
    }
    if (!isPathInside(storage.scenesDir, targetPath)) {
      res.status(400).json({ success: false, error: 'relativePath must stay within the creative scenes directory' });
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const normalizedDoc = await normalizeCreativeSceneDocForStorage(storage, doc, { forceAudioAnalysis: false });
    const payload = normalizeCreativeSceneEnvelope({
      doc: normalizedDoc,
      version: 2,
    }, {
      savedAt: new Date().toISOString(),
      sessionId,
      creativeMode,
      storageRoot: storage.rootRelPath,
    });
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8');
    const relPath = buildCreativeStorageRelativePath(storage.workspacePath, targetPath);
    _broadcastWS({
      type: 'creative_scene_saved',
      sessionId,
      creativeMode,
      path: relPath,
      absPath: targetPath,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      summary: payload.summary,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode,
      path: relPath,
      absPath: targetPath,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
      summary: payload.summary,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not save creative scene');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/api/canvas/creative-export', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default').trim() || 'default';
  const rawBase64 = String(req.body?.base64 || '').trim();
  if (!rawBase64) {
    res.status(400).json({ success: false, error: 'base64 is required' });
    return;
  }
  try {
    const requestedRoot = String(req.body?.root || '').trim();
    const storage = resolveCreativeStorage(sessionId, requestedRoot);
    const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim();
    const fallbackName = `creative-export${extensionForMimeType(mimeType) || '.bin'}`;
    const filename = sanitizeCreativeAssetFilename(req.body?.filename, fallbackName);
    const relativePath = sanitizeRelativeUploadPath(String(req.body?.relativePath || '').trim());
    let targetPath = relativePath
      ? path.resolve(storage.exportsDir, relativePath)
      : path.join(storage.exportsDir, filename);
    if (!path.extname(targetPath) && extensionForMimeType(mimeType)) {
      targetPath = `${targetPath}${extensionForMimeType(mimeType)}`;
    }
    if (!isPathInside(storage.exportsDir, targetPath)) {
      res.status(400).json({ success: false, error: 'relativePath must stay within the creative exports directory' });
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const pureBase64 = rawBase64.replace(/^data:.*?;base64,/, '');
    fs.writeFileSync(targetPath, Buffer.from(pureBase64, 'base64'));
    const relPath = buildCreativeStorageRelativePath(storage.workspacePath, targetPath);
    const stat = fs.statSync(targetPath);
    const creativeMode = String(req.body?.mode || getCreativeMode(sessionId) || '').trim() || null;
    _broadcastWS({
      type: 'creative_export_saved',
      sessionId,
      creativeMode,
      path: relPath,
      absPath: targetPath,
      mimeType,
      size: stat.size,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
    });
    res.json({
      success: true,
      sessionId,
      creativeMode,
      filename: path.basename(targetPath),
      path: relPath,
      absPath: targetPath,
      mimeType,
      size: stat.size,
      storageRoot: storage.rootAbsPath,
      storageRootRelative: storage.rootRelPath,
      usesProjectRoot: storage.usesProjectRoot,
    });
  } catch (err: any) {
    const message = String(err?.message || 'Could not save creative export');
    const status = /outside workspace|allowed/i.test(message) ? 403 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

// GET /api/creative-mode?sessionId=<id>
router.get('/api/creative-mode', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.query?.sessionId || 'default');
  res.json({ success: true, sessionId, creativeMode: getCreativeMode(sessionId) || null });
});

// POST /api/creative-mode  body: { sessionId, mode }
router.post('/api/creative-mode', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), (req: any, res: any) => {
  const sessionId = String(req.body?.sessionId || 'default');
  const mode = normalizeCreativeMode(req.body?.mode);
  const creativeMode = setCreativeMode(sessionId, mode);
  _broadcastWS({ type: 'creative_mode_changed', sessionId, creativeMode });
  res.json({ success: true, sessionId, creativeMode });
});

// ─── File Preview Routes (used by Telegram /browse preview feature) ─────────────────────
// These routes are ONLY called by the Telegram channel's file browser.
// They do not touch handleChat, sessions, SSE streams, or any main chat state.

// GET /preview?path=<rel>&token=<tok>
// Serves any workspace file as renderable HTML. HTML files are served as-is;
// other text types are wrapped in a clean styled HTML template.
router.get('/preview', async (req: any, res: any) => {
  const auth = evaluateGatewayRequest(req, { allowQueryToken: true });
  if (!auth.ok) {
    const title = auth.status === 403 ? 'Forbidden' : 'Unauthorized';
    res.status(auth.status).send(`<h1>${title}</h1>`);
    return;
  }

  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).send('<h1>path required</h1>'); return; }
  const workspacePath = getConfig().getWorkspacePath();
  const absPath = relPath.startsWith(workspacePath) ? relPath : path.join(workspacePath, relPath);
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.status(403).send('<h1>Forbidden</h1>'); return; }
  if (!fs.existsSync(absPath)) { res.status(404).send('<h1>File not found</h1>'); return; }

  const ext = path.extname(absPath).toLowerCase().slice(1);
  const content = fs.readFileSync(absPath, 'utf-8');
  const fileName = path.basename(absPath);

  // HTML — serve directly
  if (ext === 'html' || ext === 'htm') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
    return;
  }

  // SVG — serve directly
  if (ext === 'svg') {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(content);
    return;
  }

  // JSON — syntax-highlighted HTML
  if (ext === 'json') {
    let pretty = content;
    try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch {}
    const escaped = pretty.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#1e1e2e;color:#cdd6f4;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;padding:20px}pre{white-space:pre-wrap;word-break:break-word}h2{color:#89b4fa;margin:0 0 12px;font-size:14px;font-weight:600}</style>
</head><body><h2>📄 ${fileName}</h2><pre>${escaped}</pre></body></html>`);
    return;
  }

  // Markdown — render with a simple inline renderer
  if (ext === 'md' || ext === 'markdown') {
    const html = content
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^```[\s\S]*?^```/gm, (m) => `<pre><code>${m.slice(m.indexOf('\n')+1, m.lastIndexOf('```')).trim()}</code></pre>`)
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^(?!<[hul]|$)(.+)$/gm, '<p>$1</p>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;max-width:860px;margin:0 auto;padding:32px 24px}h1,h2,h3{color:#111;margin-top:1.5em}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px}pre{background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}a{color:#2563eb}li{margin:4px 0}p{margin:0.8em 0}</style>
</head><body>${html}</body></html>`);
    return;
  }

  // CSV — render as styled table
  if (ext === 'csv' || ext === 'tsv') {
    const sep = ext === 'tsv' ? '\t' : ',';
    const rows = content.split('\n').filter(Boolean).map(r => r.split(sep).map(c => c.replace(/^["']|["']$/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')));
    const thead = rows[0]?.map(c => `<th>${c}</th>`).join('') || '';
    const tbody = rows.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;background:#f9fafb;padding:16px}h2{color:#374151;font-size:14px;margin:0 0 10px}table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}th{background:#374151;color:#fff;padding:8px 12px;text-align:left;font-weight:600}td{padding:7px 12px;border-bottom:1px solid #e5e7eb;color:#111}tr:last-child td{border-bottom:none}tr:nth-child(even) td{background:#f9fafb}</style>
</head><body><h2>📊 ${fileName}</h2><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></body></html>`);
    return;
  }

  // All other text types (ts, js, py, txt, yaml, etc.) — syntax-highlighted code view
  const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const langClass = ['ts','js','py','sh','rs','go','java','cpp','c','css'].includes(ext) ? ext : 'text';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#1e1e2e;color:#cdd6f4;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6}header{background:#181825;padding:10px 20px;color:#89b4fa;font-size:13px;font-weight:600;border-bottom:1px solid #313244;position:sticky;top:0;z-index:10}pre{margin:0;padding:20px;white-space:pre-wrap;word-break:break-word}.line-num{color:#585b70;user-select:none;display:inline-block;min-width:3em;text-align:right;margin-right:16px;font-size:11px}</style>
</head><body><header>💻 ${fileName} &nbsp;<span style="color:#585b70;font-weight:400">.${ext}</span></header><pre>${
  escaped.split('\n').map((line, i) => `<span class="line-num">${i+1}</span>${line}`).join('\n')
}</pre></body></html>`);
});

// GET /api/preview/screenshot?path=<rel>&token=<tok>
// Takes a full-page screenshot of the /preview route for a given file and
// returns the chunks as base64-encoded PNGs. Called only by Telegram.
router.get('/api/preview/screenshot', (req: any, res: any, next: any) => {
  const auth = evaluateGatewayRequest(req, { allowQueryToken: true });
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }
  next();
}, async (req: any, res: any) => {
  const relPath = String(req.query.path || '').trim();
  if (!relPath) { res.status(400).json({ error: 'path required' }); return; }

  const cfg = getConfig().getConfig() as any;
  const token = resolveGatewayAuthToken();
  const port = Number(cfg?.gateway?.port || 18789);
  const host = '127.0.0.1'; // always localhost — preview is internal only
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const previewUrl = `http://${host}:${port}/preview?path=${encodeURIComponent(relPath)}${tokenParam}`;

  try {
    const chunks = await browserPreviewScreenshot(previewUrl, 1200, 10);
    res.json({ success: true, chunks, total: chunks.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/open-path — open a path in the OS file manager / shell
router.get('/api/open-path', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const fp = req.query.path as string;
  if (!fp) { res.status(400).json({ error: 'Path required' }); return; }
  try {
    const { exec } = await import('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${fp}"` : process.platform === 'darwin' ? `open "${fp}"` : `xdg-open "${fp}"`;
    exec(cmd, (err) => { err ? res.status(500).json({ error: err.message }) : res.json({ success: true }); });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/clear-history — clear chat history for a session
router.post('/api/clear-history', (req: any, res: any, next: any) => _requireGatewayAuth(req, res, next), async (req: any, res: any) => {
  const sid = req.body.sessionId || 'default';
  const ws = getWorkspace(sid) || (getConfig().getConfig() as any).workspace?.path || '';
  if (ws) {
    await hookBus.fire({
      type: 'command:reset',
      sessionId: sid,
      workspacePath: ws,
      timestamp: Date.now(),
    });
    await hookBus.fire({
      type: 'command:new',
      sessionId: sid,
      workspacePath: ws,
      timestamp: Date.now(),
    });
  }
  clearHistory(sid);
  res.json({ success: true });
});
