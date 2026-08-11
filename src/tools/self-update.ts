/**
 * Queue a Prometheus self-update through the canonical updater protocol.
 *
 * The trusted packaged Electron main process owns release verification,
 * backup, installation, relaunch, and restart validation. This tool only
 * records an authenticated request for that process to consume.
 */

import path from 'path';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';
import { collectUserStateRoots, requestCanonicalUpdate } from '../update/canonical-updater.js';

export async function executeSelfUpdate(): Promise<ToolResult> {
  const configManager = getConfig();
  const configDir = configManager.getConfigDir();
  const queued = requestCanonicalUpdate(configDir, {
    action: 'apply',
    source: 'self_update',
    confirmed: true,
    stateRoots: collectUserStateRoots(path.dirname(configDir), configManager.getConfig()),
  });

  if (!queued.ok) {
    return {
      success: false,
      error: queued.message,
    };
  }

  return {
    success: true,
    stdout: [
      '🔥 Safe self-update queued.',
      '',
      'Prometheus will verify the release, preserve an encrypted state backup,',
      'drain active work, install, relaunch, and validate before reporting completion.',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  };
}

export const selfUpdateTool = {
  name: 'self_update',
  description:
    'Trigger a Prometheus self-update through the canonical safe updater. ' +
    'The release is verified and user state is backed up before installation. ' +
    'IMPORTANT: Before calling this tool, tell the user you are starting the update and will message them when back online.',
  execute: executeSelfUpdate,
  schema: {
    // No arguments needed
  },
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};
