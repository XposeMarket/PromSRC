/**
 * image-tools.ts — Agent tools for fetching and uploading images
 *
 * Tools:
 *   upload_image   — Upload an image to Supabase Storage, returns public URL
 *   fetch_image    — Download an image from a URL and upload to Supabase Storage
 *
 * Agents use these to:
 *   1. Fetch a relevant image from the web (or generate one)
 *   2. Upload it to the `news-images` Supabase Storage bucket
 *   3. Store the returned public URL in posts.image_url
 *
 * Config required (in .env or Vault):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ToolResult } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabaseConfig(): { url: string; key: string } | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function safeFilename(original: string, ext: string): string {
  const base = original
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const hash = crypto.randomBytes(4).toString('hex');
  return `${base}-${hash}${ext}`;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  };
  return map[mime.toLowerCase()] ?? '.jpg';
}

// ─── upload_image ─────────────────────────────────────────────────────────────

export const uploadImageTool = {
  name: 'upload_image',
  description:
    'Upload an image file (from local path or base64 data) to Supabase Storage. ' +
    'Returns a public CDN URL to use in posts.image_url. ' +
    'Bucket: news-images. Supported: JPEG, PNG, WebP, GIF. ' +
    'Use action=upload_file to upload a local file, action=upload_base64 for base64 data.',
  schema: {
    action: 'upload_file | upload_base64',
    file_path: 'Local file path (for upload_file)',
    base64_data: 'Base64-encoded image data without data: prefix (for upload_base64)',
    mime_type: 'MIME type e.g. image/jpeg (for upload_base64)',
    filename_hint: 'Suggested filename base, e.g. "ai-robot-news" (optional)',
    bucket: 'Storage bucket name (default: news-images)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['upload_file', 'upload_base64'] },
      file_path: { type: 'string' },
      base64_data: { type: 'string' },
      mime_type: { type: 'string' },
      filename_hint: { type: 'string' },
      bucket: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim();
    const bucket = String(args?.bucket || 'news-images').trim();
    const hint = String(args?.filename_hint || 'image').trim();

    const cfg = getSupabaseConfig();
    if (!cfg) {
      return {
        success: false,
        error: 'Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      };
    }

    try {
      let imageBuffer: Buffer;
      let mimeType: string;
      let filename: string;

      if (action === 'upload_file') {
        const filePath = String(args?.file_path || '').trim();
        if (!filePath) return { success: false, error: 'file_path is required for upload_file' };
        if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

        imageBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
        };
        mimeType = mimeMap[ext] ?? 'image/jpeg';
        filename = safeFilename(hint, ext || '.jpg');

      } else if (action === 'upload_base64') {
        const b64 = String(args?.base64_data || '').trim();
        mimeType = String(args?.mime_type || 'image/jpeg').trim();
        if (!b64) return { success: false, error: 'base64_data is required for upload_base64' };
        // Strip data URI prefix if present
        const cleanB64 = b64.replace(/^data:[^;]+;base64,/, '');
        imageBuffer = Buffer.from(cleanB64, 'base64');
        filename = safeFilename(hint, mimeToExt(mimeType));

      } else {
        return { success: false, error: `Unknown action "${action}". Use upload_file or upload_base64` };
      }

      // Upload to Supabase Storage REST API
      const uploadUrl = `${cfg.url}/storage/v1/object/${bucket}/${filename}`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: imageBuffer,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { success: false, error: `Supabase Storage upload failed (${response.status}): ${errText.slice(0, 200)}` };
      }

      const publicUrl = `${cfg.url}/storage/v1/object/public/${bucket}/${filename}`;
      return {
        success: true,
        stdout: `Image uploaded successfully.\nPublic URL: ${publicUrl}`,
        data: {
          url: publicUrl,
          bucket,
          filename,
          mime_type: mimeType,
          size_bytes: imageBuffer.length,
        },
      };
    } catch (err: any) {
      return { success: false, error: `upload_image error: ${String(err?.message || err)}` };
    }
  },
};

// ─── fetch_image ──────────────────────────────────────────────────────────────

export const fetchImageTool = {
  name: 'fetch_image',
  description:
    'Download an image from a URL and upload it to Supabase Storage. ' +
    'Returns the Supabase public CDN URL. ' +
    'Use this when an article has an external image that you want to host permanently.',
  schema: {
    url: 'URL of the image to fetch and re-host',
    filename_hint: 'Suggested filename base, e.g. "bitcoin-crash-news"',
    bucket: 'Storage bucket name (default: news-images)',
  },
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Image URL to fetch' },
      filename_hint: { type: 'string', description: 'Filename hint' },
      bucket: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const imageUrl = String(args?.url || '').trim();
    const hint = String(args?.filename_hint || 'news-image').trim();
    const bucket = String(args?.bucket || 'news-images').trim();

    if (!imageUrl) return { success: false, error: 'url is required' };

    const cfg = getSupabaseConfig();
    if (!cfg) {
      return {
        success: false,
        error: 'Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      };
    }

    try {
      // Fetch the image
      const imgResponse = await fetch(imageUrl, {
        headers: { 'User-Agent': 'XposeNews-Bot/1.0' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!imgResponse.ok) {
        return { success: false, error: `Failed to fetch image (${imgResponse.status}): ${imageUrl}` };
      }

      const contentType = imgResponse.headers.get('content-type') ?? 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();

      if (!mimeType.startsWith('image/')) {
        return { success: false, error: `URL does not point to an image (content-type: ${contentType})` };
      }

      const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
      const ext = mimeToExt(mimeType);
      const filename = safeFilename(hint, ext);

      // Upload to Supabase
      const uploadUrl = `${cfg.url}/storage/v1/object/${bucket}/${filename}`;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: imageBuffer,
      });

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text().catch(() => '');
        return { success: false, error: `Supabase upload failed (${uploadResponse.status}): ${errText.slice(0, 200)}` };
      }

      const publicUrl = `${cfg.url}/storage/v1/object/public/${bucket}/${filename}`;
      return {
        success: true,
        stdout: `Image fetched and re-hosted.\nOriginal: ${imageUrl}\nPublic URL: ${publicUrl}`,
        data: {
          url: publicUrl,
          original_url: imageUrl,
          bucket,
          filename,
          mime_type: mimeType,
          size_bytes: imageBuffer.length,
        },
      };
    } catch (err: any) {
      return { success: false, error: `fetch_image error: ${String(err?.message || err)}` };
    }
  },
};
