import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const dispatch = read('src/gateway/teams/team-dispatch-runtime.ts');
const coordinator = read('src/gateway/teams/team-coordinator.ts');
const memberRoom = read('src/gateway/teams/team-member-room.ts');

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: start marker missing`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: end marker missing`);
  return source.slice(startIndex, endIndex);
}

assert.equal(count(dispatch, /registerLiveRuntime\s*\(/g), 1, 'dispatch must have one live-runtime registration');
assert.equal(count(coordinator, /registerLiveRuntime\s*\(/g), 2, 'both coordinator entry points must register');
assert.equal(count(memberRoom, /registerLiveRuntime\s*\(/g), 2, 'room and direct member turns must register');

for (const [label, source, expectedHooks] of [
  ['dispatch', dispatch, 1],
  ['coordinator', coordinator, 2],
  ['member room', memberRoom, 2],
]) {
  assert.equal(count(source, /onShutdownInterrupt:\s*\(\)\s*=>/g), expectedHooks, `${label}: every registration needs a shutdown-only hook`);
  assert.equal(count(source, /recoveryPolicy:\s*'(?:resume|mark_interrupted)'/g), expectedHooks, `${label}: every registration needs an explicit recovery policy`);
  assert.match(source, /new AbortController\(\)/, `${label}: shutdown must cancel underlying model\/tool I\/O`);
  assert.match(source, /if \(!abortSignal\.interrupted\)/, `${label}: finally cleanup must preserve restart ownership`);
}

assert.match(dispatch, /onShutdownInterrupt:[\s\S]{0,500}restoreDispatchMessagesForShutdown[\s\S]{0,300}interruptForShutdown/, 'dispatch shutdown must restore drained member messages before aborting I/O');
assert.match(coordinator, /onShutdownInterrupt:[\s\S]{0,500}restoreManagerMessagesForShutdown[\s\S]{0,300}interruptForShutdown/g, 'coordinator shutdown must restore its drained inbox');
assert.match(memberRoom, /onShutdownInterrupt:[\s\S]{0,500}restoreMemberMessagesForShutdown[\s\S]{0,300}interruptForShutdown/, 'room shutdown must restore drained room messages');
assert.match(memberRoom, /onShutdownInterrupt:[\s\S]{0,500}restoreDirectMessagesForShutdown[\s\S]{0,300}interruptForShutdown/, 'direct shutdown must restore drained direct messages');

const dispatchCatch = section(dispatch, '} catch (err: any) {', '} finally {', 'dispatch catch');
assert.match(dispatchCatch, /^} catch \(err: any\) \{\s*if \(abortSignal\.interrupted\)[\s\S]*holdTeamDispatchForGatewayShutdown/, 'dispatch catch must park restart unwind before failed-task writes');
assert.ok(dispatchCatch.indexOf('holdTeamDispatchForGatewayShutdown') < dispatchCatch.indexOf("updateTaskStatus(cronTask.id, 'failed'"), 'dispatch restart guard must precede failure mutation');

const detailedCoordinator = section(coordinator, 'export async function runCoordinatorConversationDetailed(', 'export async function runCoordinatorReview(', 'detailed coordinator');
assert.match(detailedCoordinator, /if \(abortSignal\.interrupted\) \{\s*await holdTeamManagerForGatewayShutdown\(\)/, 'detailed coordinator needs a restart-only hold');
assert.ok(detailedCoordinator.indexOf('holdTeamManagerForGatewayShutdown') < detailedCoordinator.indexOf('[Interrupted by user]'), 'restart guard must precede the explicit operator-abort message');
assert.match(detailedCoordinator, /if \(abortSignal\.aborted\)[\s\S]{0,500}\[Interrupted by user\]/, 'explicit operator abort behavior must remain separate and user-visible');

const roomTurn = section(memberRoom, 'export async function runTeamMemberRoomTurn(', 'export async function runTeamMemberDirectTurn(', 'room member turn');
assert.ok(roomTurn.indexOf('holdTeamMemberForGatewayShutdown') < roomTurn.indexOf('Room turn failed:'), 'room restart guard must precede failed-room mutation');
const directTurn = memberRoom.slice(memberRoom.indexOf('export async function runTeamMemberDirectTurn('));
assert.ok(directTurn.indexOf('holdTeamMemberForGatewayShutdown') < directTurn.indexOf('Direct reply failed:'), 'direct restart guard must precede failed-direct mutation');

assert.match(dispatch, /TEAM_DISPATCH_SHUTDOWN_HOLD = new Promise<never>/, 'dispatch old-process caller must remain pending during replacement handoff');
assert.match(coordinator, /TEAM_MANAGER_SHUTDOWN_HOLD = new Promise<never>/, 'manager old-process caller must remain pending during replacement handoff');
assert.match(memberRoom, /TEAM_MEMBER_SHUTDOWN_HOLD = new Promise<never>/, 'member old-process caller must remain pending during replacement handoff');

console.log('team orderly-shutdown contract: ok');
