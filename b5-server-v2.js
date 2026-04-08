const fs = require('fs');

let content = fs.readFileSync('src/gateway/server-v2.ts', 'utf-8');
const lines = content.split('\n');
console.log(`Starting lines: ${lines.length}`);

// ─── Step 1: Add import from chat-helpers ────────────────────────────────────
content = content.replace(
  `import { getMCPManager } from './mcp-manager';`,
  `import { getMCPManager } from './mcp-manager';
import {
  buildTools,
  executeTool,
  _dispatchToAgent,
  getOrchestrationSessionStats,
  orchestrationSessionStats,
  buildPersonalityContext,
  initChatHelpers,
} from './chat/chat-helpers';`
);

// ─── Step 2: Remove Block A (lines 367-705, types + helpers before singletons) ─
// Replace with a single comment line
content = content.replace(
  `type OrchestrationEvent = {
  ts: number;
  trigger: 'preflight' | 'explicit' | 'auto';
  mode: 'planner' | 'rescue';
  reason: string;
  route?: string;
};

type OrchestrationSessionStats = {
  assistCount: number;
  events: OrchestrationEvent[];
};

type RuntimeProgressStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

type RuntimeProgressItem = {
  id: string;
  text: string;
  status: RuntimeProgressStatus;
};

const orchestrationSessionStats: Map<string, OrchestrationSessionStats> = new Map();
const preemptSessionCounts: Map<string, number> = new Map();

// Canvas session file tracking — see routes/canvas-state.ts
// addCanvasFile, getCanvasContextBlock imported from './routes/canvas-state'`,
  `// Types, maps, and helper functions (Block A) extracted to chat/chat-helpers.ts (B5)
// orchestrationSessionStats, OrchestrationSessionStats, RuntimeProgressItem etc. imported above.
const preemptSessionCounts: Map<string, number> = new Map();`
);

// Verify Block A removal worked
if (!content.includes('// Types, maps, and helper functions (Block A)')) {
  console.error('ERROR: Block A replacement failed');
  process.exit(1);
}
console.log('✓ Block A types/maps removed');

// ─── Step 3: Remove the rest of Block A (prettifyToolName through resolveSkillsDir) ─
// These run from "function prettifyToolName" through the closing "}" of resolveSkillsDir
// We identify it by the unique text surrounding it
const blockAFnsStart = `function prettifyToolName(name: string): string {`;
const blockAFnsEnd = `const skillsDir = resolveSkillsDir(configuredSkillsDir);`;

const blockAFnsStartIdx = content.indexOf(blockAFnsStart);
const blockAFnsEndIdx = content.indexOf(blockAFnsEnd);

if (blockAFnsStartIdx === -1 || blockAFnsEndIdx === -1) {
  console.error('ERROR: Could not find Block A function boundaries');
  process.exit(1);
}

// Remove everything from prettifyToolName up to (not including) "const skillsDir"
content = content.slice(0, blockAFnsStartIdx) +
  '// Helper functions (prettifyToolName through resolveSkillsDir) extracted to chat/chat-helpers.ts (B5)\n\n' +
  content.slice(blockAFnsEndIdx);

console.log('✓ Block A functions removed');

// ─── Step 4: Remove Block C (buildBootStartupSnapshot through HandleChatResult) ─
const blockCStart = `// --- Hook: gateway:startup -> run BOOT.md ------------------------------------`;
const blockCEnd = `async function handleChat(`;

const blockCStartIdx = content.indexOf(blockCStart);
const blockCEndIdx = content.indexOf(blockCEnd);

if (blockCStartIdx === -1 || blockCEndIdx === -1) {
  console.error('ERROR: Could not find Block C boundaries');
  process.exit(1);
}

content = content.slice(0, blockCStartIdx) +
  '// Helper functions (buildBootStartupSnapshot through HandleChatResult) extracted to chat/chat-helpers.ts (B5)\n\n' +
  content.slice(blockCEndIdx);

console.log('✓ Block C removed');

// ─── Step 5: Insert initChatHelpers call after handleChat closes ──────────────
content = content.replace(
  `// Wire task-router deps`,
  `// Wire chat-helpers singletons (B5)
initChatHelpers({ handleChat, telegramChannel, makeBroadcastForTask });

// Wire task-router deps`
);
console.log('✓ initChatHelpers wired');

// ─── Step 6: Fix executeTool call sites - add deps object ────────────────────
// Old: executeTool(toolName, toolArgs, workspacePath, sessionId)
// New: executeTool(toolName, toolArgs, workspacePath, { cronScheduler, handleChat, telegramChannel, skillsManager, sanitizeAgentId, normalizeAgentsForSave, buildTeamDispatchContext, runTeamAgentViaChat, bindTeamNotificationTargetFromSession, pauseManagedTeamInternal, resumeManagedTeamInternal, handleTaskControlAction, makeBroadcastForTask }, sessionId)

const execDeps = `{ cronScheduler, handleChat, telegramChannel, skillsManager, sanitizeAgentId, normalizeAgentsForSave, buildTeamDispatchContext, runTeamAgentViaChat, bindTeamNotificationTargetFromSession, pauseManagedTeamInternal, resumeManagedTeamInternal, handleTaskControlAction, makeBroadcastForTask }`;

content = content.replaceAll(
  `await executeTool(toolName, toolArgs, workspacePath, sessionId)`,
  `await executeTool(toolName, toolArgs, workspacePath, ${execDeps}, sessionId)`
);

// The one call without sessionId
content = content.replace(
  `await executeTool(name, args, workspacePath)`,
  `await executeTool(name, args, workspacePath, ${execDeps})`
);

console.log('✓ executeTool call sites updated');

// ─── Step 7: Fix buildPersonalityContext call site - add skillsManager param ─
content = content.replace(
  `  const personalityCtx = await buildPersonalityContext(
    sessionId,
    workspacePath,
    message,
    executionMode || 'interactive',
    history.length,
    // Component 5: inject browser_vision hint when vision mode is active for this session.
    // browserVisionModeActive is declared higher in handleChat's closure scope.
    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,`,
  `  const personalityCtx = await buildPersonalityContext(
    sessionId,
    workspacePath,
    message,
    executionMode || 'interactive',
    history.length,
    skillsManager,
    // Component 5: inject browser_vision hint when vision mode is active for this session.
    // browserVisionModeActive is declared higher in handleChat's closure scope.
    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,`
);
console.log('✓ buildPersonalityContext call site updated');

// ─── Write result ─────────────────────────────────────────────────────────────
fs.writeFileSync('src/gateway/server-v2.ts', content, 'utf-8');
const newLines = content.split('\n').length;
console.log(`\nDone. Lines: ${lines.length} → ${newLines} (removed ${lines.length - newLines})`);
