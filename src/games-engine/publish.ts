/**
 * Publish: always sets the local play URL. When VERCEL_API_TOKEN is set, the
 * build/ folder is uploaded as a static deployment through the Vercel REST
 * API (inline files, v13 deployments) and publish.url is set. Without a token
 * the result says what is missing.
 */
import fs from 'fs';
import path from 'path';
import { advanceStage, gameDir, loadGame, mutateGame } from './project.js';

export function playPath(projectId: string): string { return `/api/game-projects/${projectId}/play/`; }

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, out); else out.push(path.relative(base, f).split(path.sep).join('/'));
  }
  return out;
}

async function vercelStaticDeploy(buildDir: string, name: string, token: string, teamId?: string): Promise<string> {
  const files = walk(buildDir);
  const total = files.reduce((s, f) => s + fs.statSync(path.join(buildDir, f)).size, 0);
  if (total > 40 * 1024 * 1024) throw new Error('build/ exceeds 40MB; too large for an inline Vercel deploy.');
  const body = {
    name,
    target: 'production',
    projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
    files: files.map((f) => ({ file: f, data: fs.readFileSync(path.join(buildDir, f)).toString('base64'), encoding: 'base64' })),
  };
  const url = `https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel deploy failed (${res.status}): ${json?.error?.message || 'unknown error'}`);
  const host = json?.alias?.[0] || json?.url;
  if (!host) throw new Error('Vercel deploy returned no URL.');
  return `https://${host}`;
}

export async function publishGame(ws: string, projectId: string, args: { baseUrl?: string; deploy?: boolean } = {}) {
  const p = loadGame(ws, projectId);
  const buildDir = path.join(gameDir(ws, projectId), 'build');
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) throw new Error('No build yet. Run scaffold first.');
  const localUrl = `${(args.baseUrl || '').replace(/\/$/, '')}${playPath(projectId)}`;
  let url: string | undefined;
  let note: string | undefined;
  const token = process.env.VERCEL_API_TOKEN;
  if (args.deploy === false) note = 'Deploy skipped (deploy:false).';
  else if (!token) note = 'Local play link only. Set VERCEL_API_TOKEN to deploy build/ to a public Vercel URL.';
  else {
    const slug = `prom-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game'}`;
    try { url = await vercelStaticDeploy(buildDir, slug, token, process.env.VERCEL_TEAM_ID); }
    catch (e: any) { note = String(e?.message || e); }
  }
  const room = p.design.multiplayer ? (p.publish.room || projectId) : undefined;
  const { project } = await mutateGame(ws, projectId, (proj) => {
    proj.publish = { ...proj.publish, localUrl, ...(url ? { url } : {}), ...(room ? { room } : {}), ...(note ? { note } : { note: undefined }), at: Date.now() };
    advanceStage(proj, url ? 'published' : 'playable');
  });
  return { localUrl, url, room, note, stage: project.stage };
}
