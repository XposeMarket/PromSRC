import crypto from 'node:crypto';

/** Context retrieval and skill routing depend on the exact current utterance. */
export function voiceContextRequestHash(transcript: unknown): string {
  return crypto.createHash('sha256').update(String(transcript ?? '')).digest('hex');
}

export function voiceContextEntryMatches(
  entry: { workspacePath: string; historyLength: number; targetKey: string; requestHash?: string },
  request: { workspacePath: string; historyLength: number; targetKey: string; requestHash: string },
): boolean {
  return entry.workspacePath === request.workspacePath
    && entry.historyLength === request.historyLength
    && entry.targetKey === request.targetKey
    && entry.requestHash === request.requestHash;
}
