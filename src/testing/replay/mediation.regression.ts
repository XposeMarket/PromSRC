/**
 * Complete mediation: the dispatch policy holds on every path that can run a
 * tool, not only interactive main chat.
 *
 * The turn loop (handleChat) is shared by main chat, background agents,
 * subagent tasks, team members, cron, heartbeat and proposal execution; they
 * differ by executionMode and, for agents, an allowed_tools filter. Each mode
 * is run here against the real loop with a scripted model that tries to
 * escape: an unknown tool, a tool from an inactive category, and (for
 * restricted agents) a tool outside the allowlist. Voice, which calls
 * executeTool outside the loop, is checked through its own entry point.
 *
 * Run: npm run test:mediation
 */
import assert from 'node:assert/strict';
import { bootReplayHarness } from './harness';
import { lastToolResultText } from './scripted-provider';

const EXECUTION_MODES = [
  'interactive',
  'background_agent',
  'background_task',
  'team_subagent',
  'team_manager',
  'cron',
  'heartbeat',
  'proposal_execution',
];

async function main(): Promise<void> {
  const h = await bootReplayHarness();
  const rows: string[] = [];
  let failures = 0;
  const check = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      rows.push(`  ok    ${label}`);
    } catch (err: any) {
      failures += 1;
      rows.push(`  FAIL  ${label}\n        ${String(err?.message || err).split('\n')[0]}`);
    }
  };

  try {
    for (const mode of EXECUTION_MODES) {
      await check(`${mode}: unknown tool is refused, no approval`, async () => {
        const run = await h.runTurn({
          message: 'Do the thing',
          executionMode: mode,
          approvals: 'approve',
          timeoutMs: 20_000,
          script: [{ toolCalls: [{ name: 'definitely_not_a_tool', args: {} }] }, { text: 'Done.' }],
        });
        assert.equal(run.error, null, String(run.error?.message || ''));
        assert.deepEqual(run.dispatched, [], 'unknown tool reached executeTool');
        assert.deepEqual(run.approvals, [], 'unknown tool raised an approval');
        assert.match(lastToolResultText(run.provider.requests[1]), /Unknown tool/);
      });

      await check(`${mode}: tool from an inactive category is refused`, async () => {
        const run = await h.runTurn({
          message: 'Do the thing',
          executionMode: mode,
          timeoutMs: 20_000,
          tools: { desktop_screenshot: () => ({ result: 'captured (stub)' }) },
          script: [{ toolCalls: [{ name: 'desktop_screenshot', args: {} }] }, { text: 'Done.' }],
        });
        assert.equal(run.error, null, String(run.error?.message || ''));
        assert.ok(!run.provider.requests[0].toolNames.includes('desktop_screenshot'), 'precondition: not offered');
        assert.ok(!run.dispatched.includes('desktop_screenshot'), 'un-offered tool reached executeTool');
      });
    }

    for (const mode of ['background_agent', 'team_subagent', 'interactive']) {
      await check(`${mode} with allowed_tools: tool outside the allowlist is refused`, async () => {
        const run = await h.runTurn({
          message: 'Fetch a page and list skills',
          executionMode: mode,
          toolFilter: ['skill_list'],
          timeoutMs: 20_000,
          // web_fetch is a core tool, so it is only off-surface because of the allowlist.
          // (write_note is deliberately guaranteed to background/team agents.)
          tools: { web_fetch: () => ({ result: 'fetched (stub)' }) },
          script: [
            { toolCalls: [{ name: 'web_fetch', args: { url: 'https://example.com' } }] },
            { toolCalls: [{ name: 'skill_list', args: { query: 'x' } }] },
            { text: 'Done.' },
          ],
        });
        assert.equal(run.error, null, String(run.error?.message || ''));
        assert.ok(!run.provider.requests[0].toolNames.includes('web_fetch'), 'precondition: allowlist hides web_fetch');
        assert.ok(!run.dispatched.includes('web_fetch'), 'web_fetch ran outside the allowlist');
        assert.match(lastToolResultText(run.provider.requests[1]), /restricted/);
        assert.ok(run.dispatched.includes('skill_list'), 'allowlisted tool still runs');
      });
    }

    await check('allowed_tools agent cannot unlock tools via request_tool_category', async () => {
      const run = await h.runTurn({
        message: 'Take a screenshot',
        executionMode: 'background_agent',
        toolFilter: ['skill_list'],
        timeoutMs: 20_000,
        tools: { desktop_screen: () => ({ result: 'captured (stub)' }) },
        script: [
          { toolCalls: [{ name: 'request_tool_category', args: { category: 'desktop_automation' } }] },
          { toolCalls: [{ name: 'desktop_screen', args: { action: 'screenshot' } }] },
          { text: 'Done.' },
        ],
      });
      assert.equal(run.error, null, String(run.error?.message || ''));
      assert.ok(!run.dispatched.includes('desktop_screen'), 'restricted agent escaped its allowlist through a category request');
    });

    await check('voice: unknown tool is refused before executeTool', async () => {
      const sessionId = `replay_voice_${Date.now().toString(36)}`;
      const { output, dispatched } = await h.runEntry(sessionId, (router) => router.__voiceToolEntryForTesting.call(sessionId, 'definitely_not_a_tool', {}));
      assert.deepEqual(dispatched, [], 'voice dispatched an unknown tool');
      assert.match(output, /Unknown tool|not available|unknown/i);
    });

    await check('voice: tool from an inactive category is refused before executeTool', async () => {
      const sessionId = `replay_voice_${Date.now().toString(36)}_b`;
      const { output, dispatched } = await h.runEntry(
        sessionId,
        (router) => router.__voiceToolEntryForTesting.call(sessionId, 'desktop_screenshot', {}),
        { desktop_screenshot: () => ({ result: 'captured (stub)' }) },
      );
      assert.ok(!dispatched.includes('desktop_screenshot'), 'voice ran a tool from an inactive category');
      assert.match(output, /request_tool_category/);
    });

    await check('voice: an offered tool still runs', async () => {
      const sessionId = `replay_voice_${Date.now().toString(36)}_c`;
      const { dispatched } = await h.runEntry(sessionId, (router) => router.__voiceToolEntryForTesting.call(sessionId, 'skill_list', { query: 'x' }));
      assert.ok(dispatched.includes('skill_list'), 'voice did not run an offered core tool');
    });
  } finally {
    h.shutdown();
  }

  process.stdout.write(`complete mediation\n${rows.join('\n')}\n\n${rows.length - failures} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  process.stdout.write(`mediation harness crashed: ${error?.stack || error}\n`);
  process.exit(1);
});
