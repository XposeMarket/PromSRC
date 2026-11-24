import { isCompactCommand, manualCompactions, COMPACT_BUSY } from '../../chat/manual-compact-state';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Request, Response, Router } from 'express';
import { getConfig } from '../../../config/config';
import { createMobileMainChatQueue, isMobileQueueRequestId, type MobileChatQueueRequest } from '../../chat/mobile-main-chat-queue';
import { mainChatTurnCoordinator, type SessionTurnLease } from '../../chat/turn-coordinator';
import { listInterruptedRuntimes, listLiveRuntimes } from '../../live-runtime-registry';
import { listPairedDevices, verifyDeviceToken } from '../../pairing/pairing-store';
import { flushSession, getSession, getSessionStorageDirectory, getSessionSummaryById, sessionExists } from '../../session';
import { assertSafeStorageId, storageFilePath } from '../../storage/storage-paths';

const ROUTE = '/api/chat/mobile-queue';
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MIME = /^image\/[a-z0-9.+-]{1,60}$/;
type Queue = ReturnType<typeof createMobileMainChatQueue>;
type Ref = { path: string; mimeType: string; name: string; digest: string; kind: string };
let queue: Queue | undefined;
let ready = false;
let stopping = false;
let ownsDispatch = () => false;
const writable = () => ready && !stopping && ownsDispatch();
let timer: ReturnType<typeof setInterval> | undefined;
const draining = new Set<string>();
let missedHandoffFinalization = false;

function store(): Queue {
  return queue ??= createMobileMainChatQueue(join(dirname(getSessionStorageDirectory()), 'mobile-main-chat-queue.json'));
}

function eligibleSession(sid: string): boolean {
  if (!sessionExists(sid)) return false;
  const summary = getSessionSummaryById(sid);
  // A just-created mobile chat isn't indexed until its first message is written.
  const session = summary || getSession(sid);
  return !summary?.settled && !session.settledAt && !session.voiceRoom
    && (session.channel === 'web' || session.channel === 'mobile');
}

function hasRequest(sid: string, id: string): boolean {
  // Do not reopen deleted sessions just to look up a receipt.
  return !!getSessionSummaryById(sid) && getSession(sid).history.some((row) => {
    const { clientRequestId, clientSteerId } = row as typeof row & { clientRequestId?: string; clientSteerId?: string };
    return row.role === 'user' && (clientRequestId === id || clientSteerId === id);
  });
}

function durableRequestExists(sid: string, id: string): boolean {
  try {
    const saved = JSON.parse(readFileSync(storageFilePath(getSessionStorageDirectory(), sid, '.json', 'session id'), 'utf8'));
    return Array.isArray(saved.history) && saved.history.some((row: { role?: unknown; clientRequestId?: unknown; clientSteerId?: unknown } | null) => row?.role === 'user'
      && (row.clientRequestId === id || row.clientSteerId === id));
  } catch { return false; }
}

function bindDevice(req: Request, res: Response): string | null {
  const device = verifyDeviceToken(String(req.get('x-pairing-token') || ''));
  if (!device) { res.status(401).json({ error: 'Pair this phone to use the gateway queue.' }); return null; }
  return device.id;
}

function readUpload(path: string): { data: Buffer; absolute: string } {
  // Resolve both the lexical and real path inside this gateway's upload root.
  const workspace = getConfig().getWorkspacePath();
  const root = realpathSync(resolve(workspace, 'uploads'));
  const candidate = realpathSync(resolve(workspace, path));
  const local = relative(root, candidate);
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Invalid queued upload reference.');
  const stat = statSync(candidate);
  if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES) throw new Error('Queued file is too large or is not a file.');
  const data = readFileSync(candidate);
  if (data.length > MAX_UPLOAD_BYTES) throw new Error('Queued file is too large.');
  return { data, absolute: candidate };
}

function attachmentRefs(input: unknown): Ref[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 8) throw new Error('Too many queued attachments.');
  return input.map((item) => {
    const path = String(item?.path || '').replace(/\\/g, '/');
    const mimeType = String(item?.mimeType || '');
    const name = String(item?.name || 'Image').slice(0, 180);
    const kind = ['image', 'text', 'video', 'file', 'pdf'].includes(item?.kind) ? item.kind : 'file';
    if ((kind === 'image' && !MIME.test(mimeType)) || !/^uploads\/[A-Za-z0-9_.() /-]{1,420}$/.test(path)
      || path.split('/').some((part) => part === '.' || part === '..' || !part)) throw new Error('Invalid queued upload.');
    return { path, mimeType: mimeType.slice(0, 100), name, kind, digest: createHash('sha256').update(readUpload(path).data).digest('hex') };
  });
}

export function hydrateMobileQueuedBody(body: MobileChatQueueRequest['body']) {
  const refs = (body.uploadRefs || []) as Ref[];
  const attachments = [];
  const attachmentPreviews = [];
  const paths: string[] = [];
  const text: string[] = [];
  for (const ref of refs) {
    const { data, absolute } = readUpload(ref.path);
    if (createHash('sha256').update(data).digest('hex') !== ref.digest) throw new Error('A queued attachment changed.');
    if (ref.kind === 'image') attachments.push({ type: 'image', name: ref.name, mimeType: ref.mimeType, base64: data.toString('base64') });
    attachmentPreviews.push({ kind: ref.kind, name: ref.name, mimeType: ref.mimeType, workspacePath: absolute });
    paths.push(`  - ${JSON.stringify(ref.name)} -> ${absolute}`);
    if (ref.kind === 'text') text.push(`${JSON.stringify(ref.name)}:\n${data.subarray(0, 48_000).toString('utf8').slice(0, 12_000)}`);
  }
  const fileText = text.length ? `\n\n[Attached text files]\n${text.join('\n\n')}` : '';
  const uploadText = paths.length ? `\n\n[UPLOADED FILES]\n${paths.join('\n')}` : '';
  return { ...body, message: `${body.message}${fileText}${uploadText}`, attachments, attachmentPreviews };
}

function snapshot(sid: string) {
  const { paused, items } = store().list(sid);
  return { paused: items.length && stopping ? 'storage_unavailable' : paused, items: items.map(({ id, state, body }) => ({ id, state, message: body?.message, attachmentCount: body?.attachmentCount || 0 })) };
}

export function pauseMobileMainChatQueue(sid: string, reason: string): void {
  if (!writable()) return;
  try { queue?.pause(sid, reason); }
  catch { stopping = true; console.warn('[mobile-chat-queue] Persistence failure: dispatch paused.'); }
}

export function mobileQueueBlocksNewTurn(sid: string): boolean {
  return queue?.hasActive(sid) ?? false;
}

export function stopMobileMainChatQueue(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
}

export function registerMobileMainChatQueue(router: Router, deps: {
  isBusy: (sid: string) => boolean;
  run: (request: MobileChatQueueRequest, lease: SessionTurnLease) => Promise<'finished' | 'aborted' | 'failed' | 'not_started'>;
  steer: (body: Record<string, unknown>) => { status: number; body: { error?: string } };
}) {
  async function drain(sid: string): Promise<void> {
    if (!writable() || draining.has(sid) || store().list(sid).paused
      || listInterruptedRuntimes().some((entry) => entry.kind === 'main_chat' && entry.sessionId === sid)
      || deps.isBusy(sid)) return;
    if (!eligibleSession(sid)) { pauseMobileMainChatQueue(sid, 'chat_unavailable'); return; }
    const lease = mainChatTurnCoordinator.tryAcquire(sid);
    if (!lease) return;
    draining.add(sid);
    let item: MobileChatQueueRequest | null = null;
    try {
      item = store().claim(sid);
      if (!item) return;
      if (!listPairedDevices().some((device) => device.id === item?.deviceId && device.enabled)) {
        store().finish(sid, item.id, 'not_started', 'device_unavailable');
        return;
      }
      if (durableRequestExists(sid, item.id)) { store().finish(sid, item.id, 'accepted'); return; }
      try { item = { ...item, body: hydrateMobileQueuedBody(item.body) }; }
      catch { store().finish(sid, item.id, 'not_started', 'attachment_unavailable'); return; }
      const outcome = await deps.run(item, lease);
      // On warm handoff the replacement owns the queue file. Leave the claim
      // for its recovery pass; never write an old copy after the handoff.
      if (!writable()) { missedHandoffFinalization = true; return; }
      if (outcome === 'not_started') { store().finish(sid, item.id, 'not_started', 'model_unavailable'); return; }
      if (outcome !== 'finished') pauseMobileMainChatQueue(sid, outcome === 'aborted' ? 'stopped' : 'turn_failed');
      const saved = hasRequest(sid, item.id) && flushSession(sid);
      store().finish(sid, item.id, saved ? 'accepted' : 'uncertain');
    } catch {
      try { if (item && writable()) store().finish(sid, item.id, 'uncertain'); }
      catch { stopMobileMainChatQueue(); }
      if (!item) stopMobileMainChatQueue();
      console.warn('[mobile-chat-queue] Could not reconcile a queued turn.');
    } finally {
      mainChatTurnCoordinator.release(lease);
      draining.delete(sid);
    }
  }

  const pump = () => {
    // Limit concurrent gateway-owned starts. A blocked chat does not block the others.
    if (!writable()) return;
    if (missedHandoffFinalization) {
      // If handoff was rolled back, this process is the writer again. Wait
      // for its remaining runs and reconcile only against durable history.
      if (draining.size) return;
      try {
        for (const sid of store().pendingSessions()) store().pause(sid, 'recovery_pending');
        store().recoverClaims(durableRequestExists);
        missedHandoffFinalization = false;
      } catch { stopMobileMainChatQueue(); return; }
    }
    for (const sid of store().pendingSessions()) {
      if (draining.size >= 4) break;
      void drain(sid).catch(() => { stopMobileMainChatQueue(); console.warn('[mobile-chat-queue] Dispatch paused.'); });
    }
  };

  router.get(ROUTE, (req, res) => {
    const deviceId = bindDevice(req, res);
    if (!deviceId) return;
    res.set('Cache-Control', 'no-store');
    let sid: string;
    try { sid = assertSafeStorageId(req.query.sessionId, 'session id'); }
    catch { res.status(400).json({ error: 'Invalid chat.' }); return; }
    if (!eligibleSession(sid)) { res.status(404).json({ error: 'This chat is unavailable.' }); return; }
    try {
      const id = typeof req.query.receiptId === 'string' && isMobileQueueRequestId(req.query.receiptId)
        && store().hasReceipt(sid, req.query.receiptId, deviceId) ? req.query.receiptId : undefined;
      res.json({ id, ...snapshot(sid) });
    }
    catch { res.status(503).json({ error: 'The gateway cannot read the queue.' }); }
  });

  router.post(ROUTE, (req, res) => {
    const deviceId = bindDevice(req, res);
    if (!deviceId) return;
    if (!writable()) { res.status(503).json({ error: 'The gateway queue is not ready. Your draft has not been queued.' }); return; }
    try {
      const { id, sessionId, message, attachments, selectedSkillIds, excludedSkillIds } = req.body || {};
      if (manualCompactions.has(sessionId) || isCompactCommand(message)) { res.status(409).json({ error: COMPACT_BUSY }); return; }
      const sid = assertSafeStorageId(sessionId, 'session id');
      if (typeof id !== 'string' || !isMobileQueueRequestId(id) || typeof message !== 'string' || !message.trim() || !eligibleSession(sid)) {
        res.status(400).json({ error: 'Queue requires text or files in an existing active chat.' }); return;
      }
      let refs: Ref[];
      try { refs = attachmentRefs(attachments); }
      catch { res.status(400).json({ error: 'A queued attachment is unavailable. Your draft has not been queued.' }); return; }
      const result = store().enqueue({ id, sessionId: sid, deviceId, body: {
        message: message.trim(), uploadRefs: refs,
        selectedSkillIds: Array.isArray(selectedSkillIds) ? selectedSkillIds.filter((id) => typeof id === 'string').slice(0, 64) : [],
        excludedSkillIds: Array.isArray(excludedSkillIds) ? excludedSkillIds.filter((id) => typeof id === 'string').slice(0, 64) : [],
        attachmentCount: refs.length,
      } });
      if (result !== 'queued' && result !== 'duplicate') {
        res.status(result === 'invalid' ? 400 : 409).json({ error: result === 'full' ? 'The gateway queue is full.' : result === 'conflict' ? 'That queue request ID was already used.' : 'The queued message is too large or invalid.' });
        return;
      }
      res.status(202).json({ id, ...snapshot(sid) });
      pump();
    } catch { res.status(503).json({ error: 'The gateway could not save the queued message. Keep your draft.' }); }
  });

  router.post(`${ROUTE}/action`, (req, res) => {
    if (!bindDevice(req, res)) return;
    if (!writable()) { res.status(503).json({ error: 'The gateway queue is not ready.' }); return; }
    try {
      const { id, sessionId, action, message, expectedRuntimeId } = req.body || {};
      const sid = assertSafeStorageId(sessionId, 'session id');
      if (isCompactCommand(message) || (manualCompactions.has(sid) && action !== 'delete')) { res.status(409).json({ error: COMPACT_BUSY }); return; }
      if (!eligibleSession(sid)) { res.status(404).json({ error: 'This chat is unavailable.' }); return; }
      if (action === 'steer' && isMobileQueueRequestId(id)) {
        const item = store().claim(sid, id);
        if (!item) { res.status(409).json({ error: 'This queued item is no longer steerable.' }); return; }
        let body;
        try { body = hydrateMobileQueuedBody(item.body); }
        catch { store().finish(sid, id, 'not_started', 'attachment_unavailable'); res.status(409).json({ error: 'A queued attachment is unavailable.' }); return; }
        if (!listPairedDevices().some((device) => device.id === item.deviceId && device.enabled)) {
          store().finish(sid, id, 'not_started', 'device_unavailable');
          res.status(409).json({ error: 'The sending device is no longer paired.' }); return;
        }
        const result = deps.steer({ ...body, sessionId: sid, clientSteerId: id, displayMessage: item.body.message,
          source: 'mobile_queue_button', expectedRuntimeId: typeof expectedRuntimeId === 'string' ? expectedRuntimeId : '' });
        const accepted = result.status === 200 && hasRequest(sid, id) && flushSession(sid);
        store().finish(sid, id, accepted ? 'accepted' : result.status < 500 && result.status !== 200 ? 'return_to_queue' : 'uncertain');
        if (!accepted) { res.status(409).json({ error: result.body.error || 'Steer delivery needs review.' }); return; }
        res.json(snapshot(sid));
        return;
      }
      const applied = action === 'resume' ? store().resume(sid)
        : action === 'cancel' && isMobileQueueRequestId(id) ? store().cancel(sid, id)
          : action === 'edit' && isMobileQueueRequestId(id) && typeof message === 'string' ? store().edit(sid, id, message) : false;
      if (!applied) { res.status(409).json({ error: 'This queued item has already started, changed, or needs review.' }); return; }
      res.json(snapshot(sid));
      pump();
    } catch { res.status(503).json({ error: 'The gateway could not update the queue.' }); }
  });

  return (canDispatch: () => boolean) => {
    if (ready) return;
    ownsDispatch = canDispatch;
    store().recoverClaims(durableRequestExists);
    // A previous turn may still be handled by normal recovery. Keep pending
    // work paused instead of assuming its eventual result was successful.
    const interrupted = new Set(listInterruptedRuntimes().filter((entry) => entry.kind === 'main_chat').map((entry) => entry.sessionId));
    for (const entry of listLiveRuntimes()) {
      if (entry.remoteHostPid && entry.sessionId && (entry.kind === 'main_chat' || entry.kind === 'main_chat_goal')) interrupted.add(entry.sessionId);
    }
    for (const sid of store().pendingSessions()) {
      if (interrupted.has(sid) && !store().list(sid).paused) store().pause(sid, 'recovery_pending');
    }
    ready = true;
    timer = setInterval(pump, 1000);
    timer.unref();
    pump();
  };
}
