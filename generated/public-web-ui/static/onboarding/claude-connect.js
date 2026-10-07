// One-click Claude (Pro/Max) connection.
//
// The gateway runs `claude setup-token` in a hidden terminal, captures the
// sign-in URL, and stores the resulting token in the vault itself. This module
// only opens the URL, polls status, and reports progress. The token never
// touches the browser.

function openExternal(url) {
  if (!url) return;
  if (typeof window.openPrometheusExternalLink === 'function') {
    window.openPrometheusExternalLink(url, { target: '_blank', features: 'noopener,noreferrer' });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function call(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.state) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the connect flow.
 * @param {object} opts
 *   onState(state, data)  progress callback. States: starting, awaiting_browser,
 *                         awaiting_code, installing, connected, failed, cancelled, cli_missing
 *   accountId             optional provider account id
 *   installIfMissing      auto-run the official Claude Code installer when missing
 *   signal                { cancelled: boolean } cooperative cancel flag
 * @returns {Promise<{ok:boolean, state:string, error?:string}>}
 */
export async function connectClaudeOneClick(opts = {}) {
  const onState = typeof opts.onState === 'function' ? opts.onState : () => {};
  const signal = opts.signal || { cancelled: false };
  let openedUrl = null;

  let data = await call('/api/auth/anthropic/cli/start', 'POST', { accountId: opts.accountId || '' });

  if (data.state === 'cli_missing') {
    onState('cli_missing', data);
    if (!opts.installIfMissing) return { ok: false, state: 'cli_missing', error: data.error };
    onState('installing', data);
    await call('/api/auth/anthropic/cli/install', 'POST', {});
    const installDeadline = Date.now() + 5 * 60 * 1000;
    for (;;) {
      if (signal.cancelled) return { ok: false, state: 'cancelled' };
      await sleep(1500);
      const s = await call('/api/auth/anthropic/cli/status');
      const inst = s.install || {};
      if (inst.state === 'done' || (inst.state !== 'installing' && inst.cliPath)) break;
      if (inst.state === 'failed') {
        onState('failed', { error: inst.error || 'Claude Code install failed.' });
        return { ok: false, state: 'failed', error: inst.error || 'Claude Code install failed.' };
      }
      if (Date.now() > installDeadline) {
        onState('failed', { error: 'Claude Code install timed out.' });
        return { ok: false, state: 'failed', error: 'Claude Code install timed out.' };
      }
    }
    data = await call('/api/auth/anthropic/cli/start', 'POST', { accountId: opts.accountId || '' });
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  let lastState = null;
  for (;;) {
    if (signal.cancelled) {
      await call('/api/auth/anthropic/cli/cancel', 'POST', {}).catch(() => {});
      onState('cancelled', data);
      return { ok: false, state: 'cancelled' };
    }
    if (data.authUrl && data.authUrl !== openedUrl) {
      openedUrl = data.authUrl;
      openExternal(data.authUrl);
    }
    if (data.state !== lastState) {
      lastState = data.state;
      onState(data.state, data);
    }
    if (data.state === 'connected') return { ok: true, state: 'connected' };
    if (['failed', 'cancelled', 'cli_missing'].includes(data.state)) {
      return { ok: false, state: data.state, error: data.error || 'Could not connect Claude.' };
    }
    if (Date.now() > deadline) {
      await call('/api/auth/anthropic/cli/cancel', 'POST', {}).catch(() => {});
      return { ok: false, state: 'failed', error: 'Timed out waiting for approval.' };
    }
    await sleep(1200);
    data = await call('/api/auth/anthropic/cli/status');
  }
}

export async function submitClaudeCode(code) {
  return call('/api/auth/anthropic/cli/code', 'POST', { code });
}

export async function cancelClaudeConnect() {
  return call('/api/auth/anthropic/cli/cancel', 'POST', {}).catch(() => null);
}

export function reopenClaudeSignIn(url) {
  openExternal(url);
}

window.PrometheusClaudeConnect = { connectClaudeOneClick, submitClaudeCode, cancelClaudeConnect, reopenClaudeSignIn };
