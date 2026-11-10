import { loadProject } from '../media-engine/project.js';
import { normalizeContentReview, reviewMediaPath, type ContentReview } from './content-review.js';
/** Capture the quoted project's prompts and reference files without remote fetches. */
export function videoContentReview(workspace: string, projectId: string, args: Record<string, any>, quotedUsd: number): ContentReview | undefined {
  const project = loadProject(workspace, projectId);
  const shots = project.shots.filter(s => !Array.isArray(args.shotIds) || args.shotIds.includes(s.id));
  const media: ContentReview['media'] = [];
  for (const shot of shots) for (const ref of [shot.startImage, shot.storyboard, shot.endImage]) {
    if (!ref || media.length >= 12) continue;
    try { const path = reviewMediaPath(ref); if (!/\.(mp4|webm|mov)$/i.test(path)) media.push({kind:'image',path,label:shot.title}); } catch { /* No external fetch. */ }
  }
  return normalizeContentReview({kind:'generation',text:shots.map(s => `${s.title} (${s.durationSec}s)\n${s.prompt}`).join('\n\n'),model:String(args.modelId || [...new Set(shots.map(s => s.modelId).filter(Boolean))].join(', ') || 'Project defaults'),cost:`Quoted: $${quotedUsd.toFixed(2)}`,media});
}
