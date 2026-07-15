import type { JsonValue } from '../turn-jobs/types.js';
import type { TurnFileChanges } from './turn-file-change-collector.js';

export const TURN_FILE_CHANGE_SCAN_VERSION = 1 as const;

/** Small bounded IPC envelope; the potentially large request lives in a blob. */
export interface TurnFileChangeScanInputEnvelope {
  blobRoot: string;
  requestRef: string;
}

export interface StoredTurnFileChangeScanRequest {
  version: typeof TURN_FILE_CHANGE_SCAN_VERSION;
  workspacePath: string;
  toolResults: JsonValue[];
}

/** Small bounded IPC result; diff previews remain in a blob. */
export interface TurnFileChangeScanResultReference {
  version: typeof TURN_FILE_CHANGE_SCAN_VERSION;
  resultRef: string;
  resultBytes: number;
  fileCount: number;
}

export interface StoredTurnFileChangeScanResult {
  version: typeof TURN_FILE_CHANGE_SCAN_VERSION;
  changes: TurnFileChanges | null;
}
