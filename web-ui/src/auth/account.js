/**
 * account.js — Prometheus account auth (Supabase via gateway)
 *
 * Handles login, logout, session persistence, and subscription check.
 * All Supabase calls go through the local gateway (/api/account/*) so
 * the service role key never leaves the server side.
 */

const STORAGE_KEY = 'prometheus_account';

// ─── State ────────────────────────────────────────────────────────────────────
let _account = null; // { email, userId, isAdmin, subscriptionActive }

export function getAccount() { return _account; }
export function isAuthenticated() { return !!_account; }
export function hasActiveSubscription() {
  return _account?.subscriptionActive || _account?.isAdmin;
}

// ─── Gateway calls ────────────────────────────────────────────────────────────
async function gatewayRequest(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── Login ────────────────────────────────────────────────────────────────────
export async function login(email, password) {
  const { ok, data } = await gatewayRequest('/api/account/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!ok) throw new Error(data.error || 'Login failed');

  _account = {
    email: data.email,
    userId: data.userId,
    isAdmin: data.isAdmin,
    subscriptionActive: data.subscriptionActive,
  };

  // Persist email for convenience (not tokens — those live server-side)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ email: data.email })); } catch {}

  return _account;
}

// ─── Logout ───────────────────────────────────────────────────────────────────
export async function logout() {
  await gatewayRequest('/api/account/logout', { method: 'POST' });
  _account = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Check existing session (called on app load) ──────────────────────────────
export async function checkSession() {
  const { ok, data } = await gatewayRequest('/api/account/status');
  if (ok && data.authenticated) {
    _account = {
      email: data.email,
      userId: data.userId,
      isAdmin: data.isAdmin,
      subscriptionActive: data.subscriptionActive,
    };
    return true;
  }
  return false;
}

// ─── Login UI ─────────────────────────────────────────────────────────────────
export function mountLoginScreen(onSuccess) {
  // Remove any existing login screen
  const existing = document.getElementById('prometheus-login-screen');
  if (existing) existing.remove();

  const screen = document.createElement('div');
  screen.id = 'prometheus-login-screen';
  screen.innerHTML = `
    <div class="pls-backdrop"></div>
    <div class="pls-card">
      <div class="pls-logo">
        <img src="/assets/Prometheus.png" alt="" class="pls-logo-img" />
        <span class="pls-logo-text">PROMETHEUS</span>
      </div>

      <div class="pls-tagline">Sign in to your account</div>

      <div id="pls-error" class="pls-error" style="display:none"></div>
      <div id="pls-sub-warn" class="pls-sub-warn" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        No active subscription found. <a href="https://prometheusaiagent.vercel.app/pricing" target="_blank" class="pls-link">Subscribe at prometheusaiagent.vercel.app</a>
      </div>

      <form id="pls-form" class="pls-form" autocomplete="on">
        <div class="pls-field">
          <label for="pls-email">Email</label>
          <input id="pls-email" type="email" autocomplete="email" placeholder="you@example.com" required />
        </div>
        <div class="pls-field">
          <label for="pls-password">Password</label>
          <input id="pls-password" type="password" autocomplete="current-password" placeholder="Your password" required />
        </div>
        <button type="submit" id="pls-submit" class="pls-btn">
          <span id="pls-btn-text">Sign in</span>
          <svg id="pls-spinner" class="pls-spinner" style="display:none" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </button>
      </form>

      <a href="https://prometheusaiagent.vercel.app/signup" target="_blank" class="pls-signup-link">
        Don't have an account? Create one
      </a>
    </div>
  `;

  // Inject styles
  if (!document.getElementById('pls-styles')) {
    const style = document.createElement('style');
    style.id = 'pls-styles';
    style.textContent = `
      #prometheus-login-screen {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .pls-backdrop {
        position: absolute;
        inset: 0;
        background: #0a0a0f;
        background-image: radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.07) 0%, transparent 60%);
      }
      .pls-card {
        position: relative;
        width: 100%;
        max-width: 400px;
        margin: 0 16px;
        background: rgba(18,22,30,0.98);
        border: 1px solid rgba(249,115,22,0.18);
        border-radius: 18px;
        padding: 40px 36px 32px;
        box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
        backdrop-filter: blur(20px);
      }
      .pls-logo {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 6px;
      }
      .pls-logo-img {
        width: 40px;
        height: 40px;
        object-fit: contain;
      }
      .pls-logo-text {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.1em;
        background: linear-gradient(135deg, #f97316 0%, #facc15 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .pls-tagline {
        font-size: 13px;
        color: #7a8799;
        margin-bottom: 28px;
        margin-left: 52px;
      }
      .pls-error {
        background: rgba(220,38,38,0.12);
        border: 1px solid rgba(220,38,38,0.3);
        color: #f87171;
        font-size: 13px;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .pls-sub-warn {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.25);
        color: #fbbf24;
        font-size: 13px;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .pls-sub-warn svg { flex-shrink: 0; margin-top: 1px; }
      .pls-link { color: #f97316; text-decoration: underline; }
      .pls-form { display: flex; flex-direction: column; gap: 14px; }
      .pls-field { display: flex; flex-direction: column; gap: 6px; }
      .pls-field label {
        font-size: 12px;
        font-weight: 600;
        color: #8a96a8;
        letter-spacing: 0.02em;
      }
      .pls-field input {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 11px 14px;
        font-size: 14px;
        color: #e8edf6;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .pls-field input::placeholder { color: #4a5568; }
      .pls-field input:focus { border-color: rgba(249,115,22,0.5); background: rgba(249,115,22,0.04); }
      .pls-btn {
        margin-top: 4px;
        background: linear-gradient(135deg, #f97316 0%, #ea6f10 100%);
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 12px;
        font-size: 14px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: opacity 0.15s, transform 0.1s;
        box-shadow: 0 4px 20px rgba(249,115,22,0.25);
      }
      .pls-btn:hover { opacity: 0.92; }
      .pls-btn:active { transform: scale(0.99); }
      .pls-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .pls-spinner { width: 16px; height: 16px; animation: pls-spin 0.75s linear infinite; }
      @keyframes pls-spin { to { transform: rotate(360deg); } }
      .pls-signup-link {
        display: block;
        text-align: center;
        margin-top: 20px;
        font-size: 12px;
        color: #5a6677;
        text-decoration: none;
        transition: color 0.15s;
      }
      .pls-signup-link:hover { color: #f97316; }
      #prometheus-login-screen.pls-fade-out {
        animation: pls-fadeout 0.35s ease forwards;
      }
      @keyframes pls-fadeout {
        to { opacity: 0; pointer-events: none; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(screen);

  // Prefill email from localStorage if available
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.email) document.getElementById('pls-email').value = saved.email;
  } catch {}

  // Form submit
  document.getElementById('pls-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('pls-email').value.trim();
    const password = document.getElementById('pls-password').value;
    const errorEl = document.getElementById('pls-error');
    const subWarnEl = document.getElementById('pls-sub-warn');
    const submitBtn = document.getElementById('pls-submit');
    const btnText = document.getElementById('pls-btn-text');
    const spinner = document.getElementById('pls-spinner');

    errorEl.style.display = 'none';
    subWarnEl.style.display = 'none';
    submitBtn.disabled = true;
    btnText.textContent = 'Signing in…';
    spinner.style.display = '';

    try {
      const account = await login(email, password);

      if (!account.subscriptionActive && !account.isAdmin) {
        // Show subscription warning but don't dismiss — user must subscribe
        subWarnEl.style.display = '';
        submitBtn.disabled = false;
        btnText.textContent = 'Sign in';
        spinner.style.display = 'none';
        return;
      }

      // Success — fade out and show app
      screen.classList.add('pls-fade-out');
      setTimeout(() => {
        screen.remove();
        onSuccess(account);
      }, 350);

    } catch (err) {
      errorEl.textContent = err.message || 'Login failed. Check your email and password.';
      errorEl.style.display = '';
      submitBtn.disabled = false;
      btnText.textContent = 'Sign in';
      spinner.style.display = 'none';
    }
  });
}

// ─── Dismiss login screen after successful session check ──────────────────────
export function dismissLoginScreen(account, onSuccess) {
  const screen = document.getElementById('prometheus-login-screen');
  if (screen) {
    screen.classList.add('pls-fade-out');
    setTimeout(() => { screen.remove(); onSuccess(account); }, 350);
  } else {
    onSuccess(account);
  }
}
