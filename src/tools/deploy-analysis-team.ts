// src/tools/deploy-analysis-team.ts
// CIS Phase 2 — Website Intelligence Team.
//
// Runs entirely in the main chat context — no teams infrastructure.
// Spawns 5 specialist agents in parallel via backgroundSpawn(), waits for all,
// then runs the compiler agent, reads the report, and returns it.
// Each agent is fully self-contained and writes findings files to sharedDir.

import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';
import {
  backgroundSpawn,
  backgroundJoin,
} from '../gateway/tasks/task-runner.js';

// ─── Dependency injection ─────────────────────────────────────────────────────
// Only workspacePath and broadcast needed — backgroundSpawn uses bgDeps.handleChat
// which is already injected at server boot via setBackgroundAgentDeps().

let _workspacePath: string = '';
let _broadcastFn: ((data: object) => void) | null = null;

export function injectAnalysisTeamDeps(deps: {
  workspacePath: string;
  broadcast?: (data: object) => void;
}): void {
  _workspacePath = deps.workspacePath;
  _broadcastFn = deps.broadcast ?? null;
}

// ─── Agent Prompts ────────────────────────────────────────────────────────────

function buildAnalystPrompts(url: string, sharedDir: string, workspacePath: string) {
  // Use workspace-relative paths so create_file/read_file resolve correctly
  const rel = path.relative(workspacePath, sharedDir).replace(/\\/g, '/');
  const su = url.replace(/https?:\/\//, '').replace(/\/$/, '');

  return [
    {
      id: 'seo',
      prompt: `You are a focused SEO Scanner. Analyze ${url} for SEO quality and write your findings to a file.

STEPS:
1. web_fetch("${url}") — check: title tag, meta description, h1/h2/h3 hierarchy, image alt text, canonical tag, robots meta, Open Graph tags, schema markup
2. web_search("site:${su}") — count indexed pages
3. web_search("${su} SEO") — find any external SEO data

Score each area 1-10. List top 3 issues with specific evidence.

WRITE to: ${rel}/findings-seo.md
Format:
## SEO Audit — ${su}
### Score: X/10
### Findings
[detailed observations with actual tag content found]
### Top Issues
1. [specific issue with evidence]
2. [specific issue]
3. [specific issue]`,
    },
    {
      id: 'perf',
      prompt: `You are a Performance & Stack Detective. Analyze ${url} and write findings to a file.

STEPS:
1. web_fetch("${url}") — inspect HTML for: framework/CMS (Next.js, WordPress, Shopify etc), JS bundle names, render-blocking resources, viewport meta tag, lazy loading
2. web_search("${su} tech stack builtwith OR wappalyzer") — confirm stack
3. Note performance red flags

WRITE to: ${rel}/findings-performance.md
Format:
## Performance & Stack — ${su}
### Detected Stack
[framework, CMS, CDN, key libraries]
### Performance Signals
[specific observations from the HTML]
### Issues
[numbered list of problems]`,
    },
    {
      id: 'geo',
      prompt: `You are an AI Visibility (GEO) Analyst. Check how visible ${url}'s brand is in AI answers and write findings to a file.

STEPS:
1. web_fetch("${url}") — extract brand name and product category
2. web_search("[brand] reviews")
3. web_search("best [product category] tools OR software")
4. web_search("[brand] featured OR mentioned")
5. Score visibility: High / Medium / Low / Invisible

WRITE to: ${rel}/findings-geo.md
Format:
## AI Visibility (GEO) — ${su}
### Brand: [name]
### Product Category: [what they sell]
### Visibility Score: High/Medium/Low/Invisible
### Evidence
[specific search results]
### Recommendations
[numbered list]`,
    },
    {
      id: 'links',
      prompt: `You are a Backlinks & SERP Analyst. Assess ${url}'s authority and write findings to a file.

STEPS:
1. web_search("site:${su}") — count indexed pages
2. web_search("link:${su}") — find referring domains
3. Identify the site's main keyword, search it, check if ${su} appears in top 10
4. Identify 2-3 competitors that outrank it
5. Estimate authority: Strong / Moderate / Weak / Unknown

WRITE to: ${rel}/findings-backlinks.md
Format:
## Backlinks & SERP — ${su}
### Indexed Pages: [count]
### Authority Estimate: Strong/Moderate/Weak/Unknown
### Referring Domain Signals
[what link: search found]
### SERP Position
[does the site rank for its main keywords?]
### Top Competitors
[2-3 names and why they outrank]`,
    },
    {
      id: 'content',
      prompt: `You are a Content Quality Auditor. Evaluate ${url}'s content and write findings to a file.

STEPS:
1. web_fetch("${url}") — analyze: word count estimate, readability, value proposition clarity, CTA quality, topical authority signals
2. web_fetch 1-2 additional pages if linked (About, Product, Blog)
3. Identify content gaps vs a market leader

WRITE to: ${rel}/findings-content.md
Format:
## Content Audit — ${su}
### Primary Topic: [main subject]
### Depth Score: X/10
### Strengths
[specific strengths]
### Gaps
[what's missing]
### Recommendations
[numbered list of improvements]`,
    },
  ];
}

function buildCompilerPrompt(url: string, sharedDir: string, workspacePath: string): string {
  const rel = path.relative(workspacePath, sharedDir).replace(/\\/g, '/');
  const domain = url.replace(/https?:\/\//, '').replace(/\/$/, '');
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `You are the Report Compiler for a website analysis of ${url}.

STEP 1 — Read each findings file using read_file:
- ${rel}/findings-seo.md
- ${rel}/findings-performance.md
- ${rel}/findings-geo.md
- ${rel}/findings-backlinks.md
- ${rel}/findings-content.md

If any file is missing or empty, use "Data unavailable" for that section.

STEP 2 — Write a FULL STANDALONE HTML REPORT to: ${rel}/full-report.html

The file must be a complete self-contained HTML page. Use this exact template, filling in all [PLACEHOLDER] values with real data from the findings files:

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Website Intelligence Report — ${domain}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d0d14;color:#e2e8f0;min-height:100vh;padding:0}
.topbar{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-bottom:1px solid rgba(99,102,241,0.3);padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
.topbar-left h1{font-size:22px;font-weight:700;color:#fff;margin-bottom:4px}
.topbar-left p{font-size:13px;color:rgba(255,255,255,0.45)}
.badge{background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:#818cf8;font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px;letter-spacing:0.5px}
.container{max-width:1100px;margin:0 auto;padding:32px 24px}
.section-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.35);margin-bottom:16px}
.scores{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:36px}
.score-card{background:#1a1a2e;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px 14px;text-align:center;position:relative;overflow:hidden}
.score-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.score-card.green::before{background:#4ade80}
.score-card.yellow::before{background:#facc15}
.score-card.red::before{background:#f87171}
.score-card.green{border-top-color:#4ade80}
.score-card.yellow{border-top-color:#facc15}
.score-card.red{border-top-color:#f87171}
.score-num{font-size:30px;font-weight:800;line-height:1;margin-bottom:6px}
.score-card.green .score-num{color:#4ade80}
.score-card.yellow .score-num{color:#facc15}
.score-card.red .score-num{color:#f87171}
.score-label{font-size:11px;color:rgba(255,255,255,0.45);font-weight:500;text-transform:uppercase;letter-spacing:0.5px}
.exec-summary{background:#1a1a2e;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:24px;margin-bottom:36px;line-height:1.8;font-size:15px;color:#cbd5e1}
.actions{margin-bottom:36px}
.action-item{display:flex;gap:16px;align-items:flex-start;background:#1a1a2e;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px 20px;margin-bottom:10px;transition:border-color 0.2s}
.action-item:hover{border-color:rgba(99,102,241,0.3)}
.action-num{width:28px;height:28px;border-radius:50%;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#818cf8;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.action-text{font-size:14px;color:#e2e8f0;line-height:1.6}
.action-text strong{color:#c7d2fe;display:block;margin-bottom:2px}
.findings{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:36px}
.finding-card{background:#1a1a2e;border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden}
.finding-card.full-width{grid-column:1/-1}
.finding-header{padding:14px 20px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
.finding-header:hover{background:rgba(255,255,255,0.05)}
.finding-icon{font-size:16px}
.finding-title{font-size:14px;font-weight:600;color:#e2e8f0;flex:1}
.finding-score{font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px}
.finding-score.green{background:rgba(74,222,128,0.15);color:#4ade80}
.finding-score.yellow{background:rgba(250,204,21,0.15);color:#facc15}
.finding-score.red{background:rgba(248,113,113,0.15);color:#f87171}
.chevron{color:rgba(255,255,255,0.3);font-size:12px;transition:transform 0.2s}
.finding-body{padding:20px;font-size:13px;line-height:1.8;color:#94a3b8;display:none}
.finding-body.open{display:block}
.finding-body h3{color:#c7d2fe;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;margin:14px 0 6px;font-weight:600}
.finding-body h3:first-child{margin-top:0}
.finding-body ul{padding-left:16px}
.finding-body li{margin-bottom:4px}
.finding-body strong{color:#e2e8f0}
.footer{text-align:center;padding:20px;font-size:12px;color:rgba(255,255,255,0.2);border-top:1px solid rgba(255,255,255,0.06)}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <h1>${domain}</h1>
    <p>Website Intelligence Report &nbsp;·&nbsp; ${dateStr}</p>
  </div>
  <div class="badge">PROMETHEUS INTELLIGENCE</div>
</div>
<div class="container">

  <div class="section-title">Overall Scores</div>
  <div class="scores">
    <!-- For each card: use class "green" if score ≥7 or High/Strong, "yellow" if 4-6 or Medium/Moderate, "red" if ≤3 or Low/Weak -->
    <div class="score-card [COLOR_SEO]">
      <div class="score-num">[SEO_SCORE]/10</div>
      <div class="score-label">SEO</div>
    </div>
    <div class="score-card [COLOR_PERF]">
      <div class="score-num">[PERF_SCORE]/10</div>
      <div class="score-label">Performance</div>
    </div>
    <div class="score-card [COLOR_GEO]">
      <div class="score-num">[GEO_SCORE]</div>
      <div class="score-label">AI Visibility</div>
    </div>
    <div class="score-card [COLOR_LINKS]">
      <div class="score-num">[LINKS_SCORE]</div>
      <div class="score-label">Backlinks</div>
    </div>
    <div class="score-card [COLOR_CONTENT]">
      <div class="score-num">[CONTENT_SCORE]/10</div>
      <div class="score-label">Content</div>
    </div>
  </div>

  <div class="section-title">Executive Summary</div>
  <div class="exec-summary">
    [EXECUTIVE_SUMMARY_3_TO_5_SENTENCES]
  </div>

  <div class="section-title">Top 5 Priority Actions</div>
  <div class="actions">
    <div class="action-item"><div class="action-num">1</div><div class="action-text"><strong>[ACTION_1_TITLE]</strong>[ACTION_1_DETAIL]</div></div>
    <div class="action-item"><div class="action-num">2</div><div class="action-text"><strong>[ACTION_2_TITLE]</strong>[ACTION_2_DETAIL]</div></div>
    <div class="action-item"><div class="action-num">3</div><div class="action-text"><strong>[ACTION_3_TITLE]</strong>[ACTION_3_DETAIL]</div></div>
    <div class="action-item"><div class="action-num">4</div><div class="action-text"><strong>[ACTION_4_TITLE]</strong>[ACTION_4_DETAIL]</div></div>
    <div class="action-item"><div class="action-num">5</div><div class="action-text"><strong>[ACTION_5_TITLE]</strong>[ACTION_5_DETAIL]</div></div>
  </div>

  <div class="section-title">Detailed Findings</div>
  <div class="findings">
    <div class="finding-card">
      <div class="finding-header" onclick="toggle(this)">
        <span class="finding-icon">🔍</span>
        <span class="finding-title">SEO Analysis</span>
        <span class="finding-score [COLOR_SEO]">[SEO_SCORE]/10</span>
        <span class="chevron">▼</span>
      </div>
      <div class="finding-body open">[SEO_FULL_FINDINGS_AS_HTML — convert markdown headings to h3, lists to ul/li, bold to strong]</div>
    </div>
    <div class="finding-card">
      <div class="finding-header" onclick="toggle(this)">
        <span class="finding-icon">⚡</span>
        <span class="finding-title">Performance &amp; Stack</span>
        <span class="finding-score [COLOR_PERF]">[PERF_SCORE]/10</span>
        <span class="chevron">▼</span>
      </div>
      <div class="finding-body open">[PERF_FULL_FINDINGS_AS_HTML]</div>
    </div>
    <div class="finding-card">
      <div class="finding-header" onclick="toggle(this)">
        <span class="finding-icon">🤖</span>
        <span class="finding-title">AI Visibility (GEO)</span>
        <span class="finding-score [COLOR_GEO]">[GEO_SCORE]</span>
        <span class="chevron">▼</span>
      </div>
      <div class="finding-body open">[GEO_FULL_FINDINGS_AS_HTML]</div>
    </div>
    <div class="finding-card">
      <div class="finding-header" onclick="toggle(this)">
        <span class="finding-icon">🔗</span>
        <span class="finding-title">Backlinks &amp; SERP</span>
        <span class="finding-score [COLOR_LINKS]">[LINKS_SCORE]</span>
        <span class="chevron">▼</span>
      </div>
      <div class="finding-body open">[BACKLINKS_FULL_FINDINGS_AS_HTML]</div>
    </div>
    <div class="finding-card full-width">
      <div class="finding-header" onclick="toggle(this)">
        <span class="finding-icon">✍️</span>
        <span class="finding-title">Content Quality</span>
        <span class="finding-score [COLOR_CONTENT]">[CONTENT_SCORE]/10</span>
        <span class="chevron">▼</span>
      </div>
      <div class="finding-body open">[CONTENT_FULL_FINDINGS_AS_HTML]</div>
    </div>
  </div>

</div>
<div class="footer">Generated by Prometheus Intelligence · ${dateStr} · ${url}</div>
<script>
function toggle(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector('.chevron');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}
</script>
</body>
</html>

IMPORTANT INSTRUCTIONS:
- Replace ALL [PLACEHOLDER] values with real data extracted from the findings files
- Replace [COLOR_X] with: "green" if score ≥7/High/Strong, "yellow" if 4-6/Medium/Moderate, "red" if ≤3/Low/Weak
- For finding body sections: convert the markdown content to simple HTML (## → <h3>, - items → <ul><li>, **bold** → <strong>)
- Keep the complete CSS and JS intact — do not remove any styles
- The output file must be valid HTML that renders correctly in a browser

STEP 3 — After writing the file, output: REPORT_COMPLETE`;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const deployAnalysisTeamTool = {
  name: 'deploy_analysis_team',
  schema: {
    url: 'The full URL to analyze (must include https://)',
    save_to_entity: 'Optional: entity slug to save report summary to',
  },
  description:
    'Deploy a one-shot website intelligence analysis for any URL. ' +
    'Spawns 5 specialist agents in parallel via background_spawn (SEO, performance/stack, ' +
    'AI visibility/GEO, backlinks/SERP, content audit), waits for all to complete, ' +
    'compiles a comprehensive report, and delivers it. ' +
    'After completion, ALWAYS present results using the html-interactive skill to build an ' +
    'interactive analysis dashboard (score KPI cards, priority actions, findings table), ' +
    'followed by a written executive summary and top recommendations. ' +
    'Use when the user asks to analyze, audit, or investigate any website.',
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Full URL to analyze including https://' },
      save_to_entity: {
        type: 'string',
        description: 'Optional: entity slug to append report summary to (e.g. "acme-corp")',
      },
    },
    additionalProperties: false,
  },

  execute: async (args: any): Promise<ToolResult> => {
    const url = String(args?.url || '').trim();
    if (!url || !url.startsWith('http')) {
      return { success: false, error: 'url is required and must start with http:// or https://' };
    }
    if (!_workspacePath) {
      return { success: false, error: 'deploy_analysis_team: workspacePath not injected. Check server boot.' };
    }

    const teamId = `analysis_${Date.now().toString(36)}`;
    const sharedDir = path.join(_workspacePath, '.prometheus', 'analysis', teamId);
    fs.mkdirSync(sharedDir, { recursive: true });

    const sanitizedSlug = url
      .replace(/https?:\/\//, '')
      .replace(/\/$/, '')
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase();

    console.log(`[deploy-analysis-team] Starting: ${url} → ${sharedDir}`);
    _broadcastFn?.({ type: 'analysis_started', url, teamId });

    const analysts = buildAnalystPrompts(url, sharedDir, _workspacePath);
    const ANALYST_TIMEOUT = 180_000;
    const COMPILER_TIMEOUT = 120_000;

    // ── Phase 1: Spawn all 5 analysts as true background agents, in parallel ──
    const bgIds = analysts.map(({ id, prompt }) => ({
      id,
      bgId: backgroundSpawn({
        prompt,
        joinPolicy: 'wait_all',
        timeoutMs: ANALYST_TIMEOUT,
        tags: [`analysis`, id, teamId],
      }).id,
    }));

    // Wait for all 5 to complete
    await Promise.allSettled(
      bgIds.map(({ id, bgId }) =>
        backgroundJoin({ backgroundId: bgId, joinPolicy: 'wait_all', timeoutMs: ANALYST_TIMEOUT })
          .catch((err: any) =>
            console.warn(`[deploy-analysis-team] ${id} agent join error:`, err?.message ?? err),
          ),
      ),
    );

    // ── Phase 2: Spawn compiler as a background agent, wait for it ────────────
    const compilerBgId = backgroundSpawn({
      prompt: buildCompilerPrompt(url, sharedDir, _workspacePath),
      joinPolicy: 'wait_all',
      timeoutMs: COMPILER_TIMEOUT,
      tags: ['analysis', 'compiler', teamId],
    }).id;

    await backgroundJoin({
      backgroundId: compilerBgId,
      joinPolicy: 'wait_all',
      timeoutMs: COMPILER_TIMEOUT,
    }).catch((err: any) =>
      console.warn('[deploy-analysis-team] Compiler join error:', err?.message ?? err),
    );

    // ── Read compiled report ──────────────────────────────────────────────────
    const reportPath = path.join(sharedDir, 'full-report.html');
    let reportContent = '';
    let destPath = '';

    if (fs.existsSync(reportPath)) {
      destPath = path.join(
        _workspacePath,
        `site-analysis-${sanitizedSlug}-${Date.now().toString(36)}.html`,
      );
      fs.copyFileSync(reportPath, destPath);
      reportContent = fs.readFileSync(reportPath, 'utf-8');
    } else {
      // Fallback: collect any partial findings and wrap in minimal HTML
      const parts: string[] = [];
      for (const f of [
        'findings-seo.md',
        'findings-performance.md',
        'findings-geo.md',
        'findings-backlinks.md',
        'findings-content.md',
      ]) {
        const fp = path.join(sharedDir, f);
        if (fs.existsSync(fp)) parts.push(fs.readFileSync(fp, 'utf-8'));
      }
      if (parts.length > 0) {
        const escaped = parts.join('\n\n---\n\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        reportContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Partial Report — ${url}</title><style>body{font-family:sans-serif;background:#0d0d14;color:#e2e8f0;padding:32px;max-width:900px;margin:0 auto}pre{white-space:pre-wrap;line-height:1.7;font-size:14px}</style></head><body><h2 style="color:#f87171">Partial Findings (compiler did not complete)</h2><pre>${escaped}</pre></body></html>`;
        destPath = path.join(
          _workspacePath,
          `site-analysis-${sanitizedSlug}-partial-${Date.now().toString(36)}.html`,
        );
        fs.writeFileSync(destPath, reportContent, 'utf-8');
      }
    }

    // ── Cleanup temp analysis dir ─────────────────────────────────────────────
    try { fs.rmSync(sharedDir, { recursive: true, force: true }); } catch {}

    _broadcastFn?.({ type: 'analysis_complete', url, reportPath: destPath });

    if (!reportContent) {
      return {
        success: false,
        error:
          `Analysis of ${url} produced no output. ` +
          `Specialist agents may have failed to fetch the site or write their findings.`,
      };
    }

    // ── Save to entity if requested ───────────────────────────────────────────
    if (args?.save_to_entity) {
      try {
        const ep = path.join(_workspacePath, 'entities', 'clients', `${args.save_to_entity}.md`);
        if (fs.existsSync(ep)) {
          fs.appendFileSync(
            ep,
            `\n## Website Analysis\n*${new Date().toISOString().slice(0, 10)}*\nFull report: ${destPath}\n`,
            'utf-8',
          );
        }
      } catch {}
    }

    // ── Return ────────────────────────────────────────────────────────────────
    return {
      success: true,
      stdout: [
        `✅ Website analysis complete for: ${url}`,
        destPath ? `reportPath: ${destPath}` : '',
        ``,
        `[NEXT STEPS — do these in order]`,
        `1. Call present_file({ path: "${destPath}" }) to open the HTML dashboard in the canvas`,
        `2. Write a concise executive summary (3-5 sentences) covering overall health, biggest strength, biggest weakness`,
        `3. List the top 3 actionable recommendations`,
        ``,
        `--- REPORT SUMMARY (for your reference) ---`,
        reportContent.slice(0, 3000),
        reportContent.length > 3000 ? `\n[... report truncated, full content in file ...]` : '',
        `--- END SUMMARY ---`,
      ]
        .filter(s => s !== null && s !== undefined)
        .join('\n'),
      data: { url, reportPath: destPath },
    };
  },
};
