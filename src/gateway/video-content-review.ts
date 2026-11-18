import { loadProject } from '../media-engine/project.js';
import { normalizeContentReview, reviewMediaPath, type ContentReview } from './content-review.js';
export type VideoApprovalDecision = { allow: true } | { allow: false; reason: string };

/**
 * Fail-closed gate for approving a paid video quote. Execution is allowed only when
 * a review was recorded at quote time AND the review recomputed now is identical.
 * A missing recorded review, a recompute that throws or yields nothing, or any
 * difference is refused: the user must not pay for content they did not see.
 */
export function decideVideoApproval(recorded: ContentReview | undefined, recompute: () => ContentReview | undefined): VideoApprovalDecision {
  const renew = 'Request a new generation approval.';
  if (!recorded) return { allow: false, reason: `This quote has no recorded content review, so it cannot be approved safely. ${renew}` };
  let current: ContentReview | undefined;
  try { current = recompute(); } catch { return { allow: false, reason: `The project content could not be re-checked (missing or unreadable). ${renew}` }; }
  if (!current) return { allow: false, reason: `The project content could not be re-checked. ${renew}` };
  if (JSON.stringify(recorded) !== JSON.stringify(current)) return { allow: false, reason: `The project content changed since this quote. ${renew}` };
  return { allow: true };
}

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
