// src/tools/social-scraper.ts
// CIS Phase 3 — Social Media Intelligence.
//
// Provides structured social data via a 3-tier fallback:
//   Tier 1: Official platform APIs (when OAuth token exists in vault)
//   Tier 2: Scrapling Python bridge (public profile data, no auth needed)
//   Tier 3: Browser automation fallback (logged-in dashboards)
//
// Tool: social_intel({ platform, handle, mode })
// Output: structured analysis written to entities/social/[platform].md
//         + full coach report returned to chat

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { ToolResult } from '../types.js';

// ─── Dependency injection ─────────────────────────────────────────────────────

let _workspacePath: string = '';
let _resolveSecret: ((ref: string) => Promise<string | null>) | null = null;
let _broadcastFn: ((data: object) => void) | null = null;

export function injectSocialScraperDeps(deps: {
  workspacePath: string;
  resolveSecret?: (ref: string) => Promise<string | null>;
  broadcast?: (data: object) => void;
}): void {
  _workspacePath = deps.workspacePath;
  _resolveSecret = deps.resolveSecret ?? null;
  _broadcastFn = deps.broadcast ?? null;
}

// ─── Platform configs ─────────────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<string, {
  displayName: string;
  vaultKey: string;
  apiEndpoint?: string;
  scrapingSupported: boolean;
}> = {
  instagram: {
    displayName: 'Instagram',
    vaultKey: 'social_instagram_token',
    apiEndpoint: 'https://graph.instagram.com',
    scrapingSupported: true,
  },
  tiktok: {
    displayName: 'TikTok',
    vaultKey: 'social_tiktok_token',
    scrapingSupported: true,
  },
  x: {
    displayName: 'X (Twitter)',
    vaultKey: 'social_x_token',
    apiEndpoint: 'https://api.twitter.com/2',
    scrapingSupported: true,
  },
  twitter: {
    displayName: 'X (Twitter)',
    vaultKey: 'social_x_token',
    apiEndpoint: 'https://api.twitter.com/2',
    scrapingSupported: true,
  },
  linkedin: {
    displayName: 'LinkedIn',
    vaultKey: 'social_linkedin_token',
    scrapingSupported: false, // LinkedIn blocks scraping aggressively
  },
  facebook: {
    displayName: 'Facebook',
    vaultKey: 'social_facebook_token',
    scrapingSupported: false,
  },
};

// ─── Tier 2: Scrapling Python bridge ─────────────────────────────────────────

function buildScrapingScript(platform: string, handle: string): string {
  const cleanHandle = handle.replace(/^@/, '');

  const platformUrls: Record<string, string> = {
    instagram: `https://www.instagram.com/${cleanHandle}/`,
    tiktok: `https://www.tiktok.com/@${cleanHandle}`,
    x: `https://x.com/${cleanHandle}`,
    twitter: `https://x.com/${cleanHandle}`,
    linkedin: `https://www.linkedin.com/in/${cleanHandle}/`,
  };

  const url = platformUrls[platform] || `https://${platform}.com/${cleanHandle}`;

  return `
import sys
import json

try:
    from scrapling import StealthyFetcher
    fetcher = StealthyFetcher(auto_match=False)
    page = fetcher.fetch("${url}", headless=True, network_idle=True)
    
    result = {
        "platform": "${platform}",
        "handle": "${cleanHandle}",
        "url": "${url}",
        "status": "success",
        "html_length": len(page.html_content),
        "text_preview": page.get_all_text(ignore_tags=['script','style'])[:3000],
    }
    
    # Try to extract follower counts and bio from common patterns
    import re
    text = page.get_all_text(ignore_tags=['script','style'])
    
    # Follower patterns
    follower_match = re.search(r'([0-9,\\.]+[KkMm]?)\\s*(?:followers?|Followers?)', text)
    following_match = re.search(r'([0-9,\\.]+[KkMm]?)\\s*(?:following|Following)', text)
    post_match = re.search(r'([0-9,\\.]+[KkMm]?)\\s*(?:posts?|Posts?)', text)
    
    if follower_match:
        result["followers"] = follower_match.group(1)
    if following_match:
        result["following"] = following_match.group(1)
    if post_match:
        result["posts"] = post_match.group(1)
    
    print(json.dumps(result))

except ImportError:
    # Scrapling not installed — try requests fallback
    try:
        import urllib.request
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        req = urllib.request.Request("${url}", headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
        import re
        follower_match = re.search(r'"edge_followed_by":\\{"count":([0-9]+)\\}', html) or \\
                         re.search(r'([0-9,]+)\\s*Followers', html)
        result = {
            "platform": "${platform}",
            "handle": "${cleanHandle}",
            "url": "${url}",
            "status": "fallback",
            "followers": follower_match.group(1) if follower_match else "unknown",
            "text_preview": html[:2000],
        }
        print(json.dumps(result))
    except Exception as e2:
        print(json.dumps({"status": "error", "error": str(e2), "platform": "${platform}", "handle": "${cleanHandle}"}))

except Exception as e:
    print(json.dumps({"status": "error", "error": str(e), "platform": "${platform}", "handle": "${cleanHandle}"}))
`;
}

async function runScrapingTier(platform: string, handle: string): Promise<Record<string, any> | null> {
  try {
    const script = buildScrapingScript(platform, handle);
    const tmpScript = path.join(_workspacePath, '.prometheus', `social_scrape_${Date.now()}.py`);
    fs.mkdirSync(path.dirname(tmpScript), { recursive: true });
    fs.writeFileSync(tmpScript, script, 'utf-8');

    const result = execSync(`python3 "${tmpScript}"`, { timeout: 30000, encoding: 'utf-8' });
    fs.unlinkSync(tmpScript); // clean up

    return JSON.parse(result.trim());
  } catch (err: any) {
    console.warn(`[social-scraper] Scrapling tier failed for ${platform}/${handle}:`, err.message);
    return null;
  }
}

// ─── Tier 1: Official API ─────────────────────────────────────────────────────

async function runApiTier(platform: string, handle: string, token: string): Promise<Record<string, any> | null> {
  try {
    const config = PLATFORM_CONFIG[platform];
    if (!config?.apiEndpoint) return null;

    // Instagram Graph API
    if (platform === 'instagram') {
      const url = `${config.apiEndpoint}/me?fields=id,username,account_type,media_count,followers_count,follows_count,biography,website&access_token=${token}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json() as Record<string, any>;

      // Also fetch recent media
      const mediaUrl = `${config.apiEndpoint}/me/media?fields=id,caption,media_type,timestamp,like_count,comments_count,reach,impressions&limit=25&access_token=${token}`;
      const mediaResp = await fetch(mediaUrl);
      const mediaData = mediaResp.ok ? await mediaResp.json() as Record<string, any> : { data: [] };

      return {
        platform: 'instagram',
        handle,
        status: 'api_success',
        profile: data,
        recent_posts: mediaData.data || [],
      };
    }

    // X (Twitter) Basic API
    if (platform === 'x' || platform === 'twitter') {
      const cleanHandle = handle.replace(/^@/, '');
      const url = `${config.apiEndpoint}/users/by/username/${cleanHandle}?user.fields=public_metrics,description,created_at,verified`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const data = await response.json() as Record<string, any>;
      return { platform: 'x', handle, status: 'api_success', profile: data };
    }

    return null;
  } catch (err: any) {
    console.warn(`[social-scraper] API tier failed for ${platform}/${handle}:`, err.message);
    return null;
  }
}

// ─── Analysis engine ──────────────────────────────────────────────────────────

function buildCoachReport(platform: string, handle: string, data: Record<string, any>): string {
  const today = new Date().toISOString().slice(0, 10);
  const cleanHandle = handle.replace(/^@/, '');
  const displayPlatform = PLATFORM_CONFIG[platform]?.displayName || platform;

  const lines: string[] = [
    `# Social Media Intelligence Report`,
    `**Platform:** ${displayPlatform}  **Handle:** @${cleanHandle}  **Date:** ${today}`,
    `**Data source:** ${data.status || 'scraped'}`,
    '',
  ];

  // Profile overview
  if (data.profile || data.followers) {
    lines.push('## Profile Overview');
    const profile = data.profile || {};
    const metrics = profile.public_metrics || profile;

    const followers = profile.followers_count ?? metrics.followers_count ?? data.followers ?? 'unknown';
    const following = profile.follows_count ?? metrics.following_count ?? data.following ?? 'unknown';
    const posts = profile.media_count ?? metrics.tweet_count ?? data.posts ?? 'unknown';

    lines.push(`- **Followers:** ${followers}`);
    lines.push(`- **Following:** ${following}`);
    lines.push(`- **Posts/Tweets:** ${posts}`);

    if (profile.biography || profile.description) {
      lines.push(`- **Bio:** ${profile.biography || profile.description}`);
    }
    if (profile.website) {
      lines.push(`- **Website:** ${profile.website}`);
    }
    lines.push('');
  }

  // Post analysis (Instagram API data)
  if (data.recent_posts && data.recent_posts.length > 0) {
    const posts = data.recent_posts;
    lines.push('## Recent Post Performance');

    // Calculate averages
    const withLikes = posts.filter((p: any) => p.like_count != null);
    const withComments = posts.filter((p: any) => p.comments_count != null);
    const avgLikes = withLikes.length > 0
      ? Math.round(withLikes.reduce((s: number, p: any) => s + p.like_count, 0) / withLikes.length)
      : null;
    const avgComments = withComments.length > 0
      ? Math.round(withComments.reduce((s: number, p: any) => s + p.comments_count, 0) / withComments.length)
      : null;

    if (avgLikes !== null) lines.push(`- **Avg likes:** ${avgLikes}`);
    if (avgComments !== null) lines.push(`- **Avg comments:** ${avgComments}`);

    // Top posts
    const sorted = [...posts].sort((a: any, b: any) => (b.like_count || 0) - (a.like_count || 0));
    lines.push('');
    lines.push('### Top 3 Posts by Likes');
    for (const post of sorted.slice(0, 3)) {
      const caption = (post.caption || '(no caption)').slice(0, 120).replace(/\n/g, ' ');
      lines.push(`- **${post.like_count ?? 0} likes** | ${post.media_type || ''} | ${post.timestamp?.slice(0, 10) || ''}`);
      lines.push(`  "${caption}"`);
    }

    // Caption analysis
    lines.push('');
    lines.push('### Caption Patterns');
    const captionLengths = posts.filter((p: any) => p.caption).map((p: any) => p.caption.length);
    if (captionLengths.length > 0) {
      const avgLen = Math.round(captionLengths.reduce((a: number, b: number) => a + b, 0) / captionLengths.length);
      lines.push(`- Average caption length: ${avgLen} chars`);
    }
    const withHashtags = posts.filter((p: any) => p.caption?.includes('#')).length;
    lines.push(`- Posts with hashtags: ${withHashtags}/${posts.length}`);
    lines.push('');
  }

  // Scraped text preview analysis
  if (data.text_preview && !data.recent_posts) {
    lines.push('## Scraped Profile Data');
    lines.push('*(Public data only — connect official API for full analytics)*');
    lines.push('');
    lines.push(data.text_preview.slice(0, 1000));
    lines.push('');
  }

  // Recommendations
  lines.push('## Growth Recommendations');
  lines.push('*(Based on available data — connect API for post-level analysis)*');
  lines.push('');
  lines.push('1. **Connect official API** for full post-by-post performance data');
  lines.push('2. **Run regular analysis** to track engagement rate trends over time');
  lines.push('3. **Check competitors** — use social_intel on 2-3 competitor handles');
  lines.push('');

  lines.push('---');
  lines.push(`*Report generated by Prometheus CIS Social Intelligence — ${today}*`);

  return lines.join('\n');
}

// ─── Entity persistence ───────────────────────────────────────────────────────

function persistToEntityFile(platform: string, handle: string, data: Record<string, any>, report: string): string {
  const cleanHandle = handle.replace(/^@/, '');
  const today = new Date().toISOString().slice(0, 10);
  const entityDir = path.join(_workspacePath, 'entities', 'social');
  fs.mkdirSync(entityDir, { recursive: true });

  const entityPath = path.join(entityDir, `${platform}.md`);

  const profile = data.profile || {};
  const metrics = profile.public_metrics || profile;
  const followers = profile.followers_count ?? metrics.followers_count ?? data.followers ?? 'unknown';

  const content = [
    `# ${PLATFORM_CONFIG[platform]?.displayName || platform} — Social Entity`,
    `# Last Updated: ${today}`,
    '',
    '## Overview',
    `- **Platform:** ${PLATFORM_CONFIG[platform]?.displayName || platform}`,
    `- **Handle:** @${cleanHandle}`,
    `- **Followers:** ${followers}`,
    `- **Last Synced:** ${today}`,
    `- **Data Source:** ${data.status || 'scraped'}`,
    '',
    '## Performance Summary',
    `- Last analysis: ${today}`,
    `- See full report below`,
    '',
    '## Latest Report',
    report,
  ].join('\n');

  fs.writeFileSync(entityPath, content, 'utf-8');
  return entityPath;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const socialIntelTool = {
  name: 'social_intel',
  description:
    'Analyze a social media account and get a full coach report. ' +
    'Pulls follower counts, post performance, engagement rates, top content, and growth recommendations. ' +
    'Supports: instagram, tiktok, x (twitter), linkedin. ' +
    'Uses official API if connected, falls back to public scraping. ' +
    'Saves results to entities/social/[platform].md for cross-session memory. ' +
    'Examples: social_intel({ platform: "instagram", handle: "@yourbrand" })',
  schema: {
    platform: 'Platform: instagram | tiktok | x | twitter | linkedin | facebook',
    handle: 'Account handle (with or without @)',
    mode: 'Optional: "quick" (scrape only) | "full" (API + scrape, default)',
    competitor: 'Optional: set true to analyze a competitor (skips entity write)',
  },
  jsonSchema: {
    type: 'object',
    required: ['platform', 'handle'],
    properties: {
      platform: {
        type: 'string',
        enum: ['instagram', 'tiktok', 'x', 'twitter', 'linkedin', 'facebook'],
      },
      handle: { type: 'string', description: 'Account handle e.g. "@yourbrand" or "yourbrand"' },
      mode: { type: 'string', enum: ['quick', 'full'], description: 'quick=scrape only, full=API+scrape' },
      competitor: { type: 'boolean', description: 'If true, skips writing to entity files' },
    },
    additionalProperties: false,
  },

  execute: async (args: any): Promise<ToolResult> => {
    const platform = String(args?.platform || '').toLowerCase().trim();
    const handle = String(args?.handle || '').trim();
    const mode = String(args?.mode || 'full').toLowerCase();
    const isCompetitor = Boolean(args?.competitor);

    if (!platform) return { success: false, error: 'platform is required' };
    if (!handle) return { success: false, error: 'handle is required' };

    const config = PLATFORM_CONFIG[platform];
    if (!config) {
      return { success: false, error: `Unknown platform "${platform}". Supported: ${Object.keys(PLATFORM_CONFIG).join(', ')}` };
    }

    _broadcastFn?.({ type: 'social_intel_started', platform, handle });
    console.log(`[social-intel] Analyzing ${platform}/@${handle} (mode: ${mode})`);

    let data: Record<string, any> | null = null;
    let tierUsed = 'none';

    // ── Tier 1: Try official API if token exists and mode is full ─────────────
    if (mode === 'full' && _resolveSecret) {
      try {
        const token = await _resolveSecret(`vault://${config.vaultKey}`);
        if (token) {
          data = await runApiTier(platform, handle, token);
          if (data) tierUsed = 'official_api';
        }
      } catch (e: any) {
        console.warn(`[social-intel] API tier error:`, e.message);
      }
    }

    // ── Tier 2: Scrapling fallback ─────────────────────────────────────────────
    if (!data && config.scrapingSupported) {
      data = await runScrapingTier(platform, handle);
      if (data && data.status !== 'error') tierUsed = 'scrapling';
    }

    // ── No data ────────────────────────────────────────────────────────────────
    if (!data || data.status === 'error') {
      const errMsg = data?.error || 'All data tiers failed';
      return {
        success: false,
        error: [
          `Could not retrieve data for ${platform}/@${handle}: ${errMsg}`,
          '',
          'To get full analytics, connect your official API:',
          `1. Get an access token from ${platform}'s developer portal`,
          `2. Store it: vault set ${config.vaultKey} <your_token>`,
          `3. Run social_intel again`,
        ].join('\n'),
      };
    }

    // ── Build report ───────────────────────────────────────────────────────────
    const report = buildCoachReport(platform, handle, data);

    // ── Persist to entity file (skip for competitor analysis) ─────────────────
    let entityPath = '';
    if (!isCompetitor) {
      entityPath = persistToEntityFile(platform, handle, data, report);
    }

    _broadcastFn?.({ type: 'social_intel_complete', platform, handle, tierUsed });

    return {
      success: true,
      stdout: [
        report,
        '',
        entityPath ? `📁 Saved to: ${entityPath}` : '',
        `📡 Data source: ${tierUsed}`,
      ].filter(Boolean).join('\n'),
      data: { platform, handle, tierUsed, entityPath, dataKeys: Object.keys(data) },
    };
  },
};
