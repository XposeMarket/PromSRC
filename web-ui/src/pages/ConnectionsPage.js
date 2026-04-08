/**
 * ConnectionsPage.js — F3e+ Extract (Connections panel)
 *
 * Connections panel: OAuth flows, browser login, connector CRUD, activity log.
 * Includes the CONNECTORS registry (14 connectors) and all connection functions.
 *
 * 18 functions + CONNECTORS const extracted from index.html (~610 lines).
 *
 * Dependencies: api() from api.js, escHtml/showToast from utils.js
 */

import { api } from '../api.js';
import { escHtml, showToast } from '../utils.js';

// ═══════════════════════════════════════════════════════════════════

const CONNECTORS = [
  // ── Communication ──
  {
    id: 'gmail', name: 'Gmail', category: 'Email', authType: 'oauth',
    color: '#EA4335',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><path fill="#EA4335" d="M6 8h36l-18 14z"/><path fill="#FBBC05" d="M6 8L0 4v36l6-6z"/><path fill="#34A853" d="M42 8l6-4v36l-6-6z"/><path fill="#4285F4" d="M0 40l14-12 10 8 10-8 14 12z"/><path fill="#EA4335" d="M6 8L24 22 42 8H6z"/></svg>`,
    desc: 'Connect Gmail so Prom can read your inbox, draft replies, send emails, and track communication with clients — all without leaving your workspace.',
    permissions: [
      { icon: '📥', label: 'Read inbox and thread history' },
      { icon: '✉️', label: 'Draft and send emails (with your approval)' },
      { icon: '🔍', label: 'Search emails by sender, subject, or keyword' },
      { icon: '📎', label: 'Read and download attachments' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'slack', name: 'Slack', category: 'Messaging', authType: 'oauth',
    color: '#4A154B',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><path fill="#E01E5A" d="M13 28a5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5h5z"/><path fill="#E01E5A" d="M15.5 28a5 5 0 0 1 5-5 5 5 0 0 1 5 5v12.5a5 5 0 0 1-5 5 5 5 0 0 1-5-5z"/><path fill="#36C5F0" d="M20.5 13a5 5 0 0 1-5-5 5 5 0 0 1 5-5 5 5 0 0 1 5 5v5z"/><path fill="#36C5F0" d="M20.5 15.5a5 5 0 0 1 5 5 5 5 0 0 1-5 5H8a5 5 0 0 1-5-5 5 5 0 0 1 5-5z"/><path fill="#2EB67D" d="M35.5 20.5a5 5 0 0 1 5-5 5 5 0 0 1 5 5 5 5 0 0 1-5 5h-5z"/><path fill="#2EB67D" d="M33 20.5a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8a5 5 0 0 1 5-5 5 5 0 0 1 5 5z"/><path fill="#ECB22E" d="M27.5 35.5a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5v-5z"/><path fill="#ECB22E" d="M27.5 33a5 5 0 0 1-5-5 5 5 0 0 1 5-5H40a5 5 0 0 1 5 5 5 5 0 0 1-5 5z"/></svg>`,
    desc: 'Connect Slack so Prom can read channels, send messages on your behalf, search conversations, and get notified about mentions — keeping your team loop tight.',
    permissions: [
      { icon: '💬', label: 'Read public and private channel messages' },
      { icon: '📤', label: 'Post messages (with your approval)' },
      { icon: '🔔', label: 'Monitor mentions and DMs' },
      { icon: '🔍', label: 'Search message history' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'github', name: 'GitHub', category: 'Dev', authType: 'oauth',
    color: '#24292e',
    logo: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#24292e"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.4.6.1.82-.26.82-.58v-2.03c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.06 1.82 2.79 1.29 3.47.99.1-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.005 2.05.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.69.82.57C20.56 22.3 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z"/></svg>`,
    desc: "Connect GitHub so Prom can read pull requests, issues, and commits — automatically surfacing what needs review, what's blocked, and what shipped.",
    permissions: [
      { icon: '🔀', label: 'Read PRs, issues, and commits' },
      { icon: '💬', label: 'Post comments on PRs and issues (with approval)' },
      { icon: '📋', label: 'Create and update issues' },
      { icon: '🔍', label: 'Search repos and code' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'notion', name: 'Notion', category: 'Docs', authType: 'oauth',
    color: '#000000',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect width="48" height="48" rx="8" fill="#fff"/><path d="M10 10h28v4H10zM10 20h20v4H10zM10 30h24v4H10z" fill="#191919"/><path d="M34 14l4 8-4 2z" fill="#191919"/></svg>`,
    desc: 'Connect Notion so Prom can read your docs, databases, and pages — giving it full context on your internal knowledge base, project plans, and SOPs.',
    permissions: [
      { icon: '📄', label: 'Read pages, databases, and blocks' },
      { icon: '✏️', label: 'Create and update pages (with approval)' },
      { icon: '🔍', label: 'Search across your workspace' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'hubspot', name: 'HubSpot', category: 'CRM', authType: 'oauth',
    color: '#FF7A59',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><circle cx="24" cy="14" r="6" fill="#FF7A59"/><circle cx="38" cy="26" r="5" fill="#FF7A59"/><circle cx="10" cy="26" r="5" fill="#FF7A59"/><circle cx="24" cy="38" r="6" fill="#FF7A59"/><line x1="24" y1="20" x2="24" y2="32" stroke="#FF7A59" stroke-width="2.5"/><line x1="15" y1="26" x2="33" y2="26" stroke="#FF7A59" stroke-width="2.5"/></svg>`,
    desc: 'Connect HubSpot so Prom can pull CRM contacts, deals, and pipeline stages — keeping it aware of every active opportunity without you having to narrate your sales process.',
    permissions: [
      { icon: '👤', label: 'Read contacts, companies, and deals' },
      { icon: '📊', label: 'Read pipeline and deal stages' },
      { icon: '✏️', label: 'Log activity and update records (with approval)' },
      { icon: '📧', label: 'Create tasks and follow-ups' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'salesforce', name: 'Salesforce', category: 'CRM', authType: 'oauth',
    color: '#00A1E0',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><path d="M20 10c3-4 9-5 13-1 2-1 5-1 7 1 3 0 6 2 6 5s-2 5-5 5H8c-3 0-5-2-5-5s2-5 5-4c1-3 4-5 7-4 1-2 3-4 5-4v7z" fill="#00A1E0"/><rect x="8" y="20" width="32" height="18" rx="4" fill="#00A1E0"/></svg>`,
    desc: 'Connect Salesforce so Prom can read accounts, opportunities, and contacts — surfacing deal context automatically and drafting CRM updates without you switching apps.',
    permissions: [
      { icon: '🏢', label: 'Read accounts, contacts, and opportunities' },
      { icon: '📈', label: 'Read pipeline and forecast data' },
      { icon: '✏️', label: 'Update records and log activity (with approval)' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'stripe', name: 'Stripe', category: 'Finance', authType: 'oauth',
    color: '#635BFF',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect width="48" height="48" rx="8" fill="#635BFF"/><path d="M22 18c0-1.7 1.4-2.4 3.5-2.4 3.1 0 6.3.9 8.5 2.5V10c-2.8-1.1-5.6-1.5-8.5-1.5-7 0-11.5 3.6-11.5 9.7 0 9.4 13 7.9 13 12 0 2-1.7 2.7-4 2.7-3.4 0-7.1-1.4-9.7-3.3v8.2c3.3 1.4 6.6 2 9.7 2 7.2 0 12-3.6 12-9.7C35 20.3 22 22 22 18z" fill="white"/></svg>`,
    desc: 'Connect Stripe so Prom can read revenue, subscriptions, and invoice history — giving it live financial context to answer questions about MRR, churn, and outstanding payments.',
    permissions: [
      { icon: '💰', label: 'Read revenue, invoices, and subscriptions' },
      { icon: '📊', label: 'Read MRR, churn, and customer data' },
      { icon: '🔒', label: 'Read-only — no payment actions ever' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'ga4', name: 'Analytics', category: 'Analytics', authType: 'oauth',
    color: '#F9A825',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect x="6" y="24" width="8" height="18" rx="3" fill="#F9A825"/><rect x="20" y="14" width="8" height="28" rx="3" fill="#F57F17"/><rect x="34" y="6" width="8" height="36" rx="3" fill="#E65100"/></svg>`,
    desc: 'Connect Google Analytics 4 so Prom can pull traffic, conversions, and top pages — surfacing site performance data automatically when relevant.',
    permissions: [
      { icon: '📊', label: 'Read sessions, pageviews, and conversions' },
      { icon: '🔍', label: 'Query custom reports and events' },
      { icon: '🔒', label: 'Read-only access' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'instagram', name: 'Instagram', category: 'Social', authType: 'browser',
    color: '#E1306C',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><defs><radialGradient id="ig-g" cx="30%" cy="100%" r="120%"><stop offset="0%" stop-color="#FFDC80"/><stop offset="30%" stop-color="#FCAF45"/><stop offset="55%" stop-color="#F77737"/><stop offset="70%" stop-color="#F56040"/><stop offset="80%" stop-color="#FD1D1D"/><stop offset="100%" stop-color="#833AB4"/></radialGradient></defs><rect width="48" height="48" rx="12" fill="url(#ig-g)"/><rect x="12" y="12" width="24" height="24" rx="6" fill="none" stroke="white" stroke-width="2.5"/><circle cx="24" cy="24" r="6" fill="none" stroke="white" stroke-width="2.5"/><circle cx="33" cy="15" r="2" fill="white"/></svg>`,
    desc: 'Connect Instagram so Prom can pull post analytics, engagement rates, follower growth, and run social coaching analysis — using your real data, not estimates.',
    permissions: [
      { icon: '📸', label: 'Read posts, reels, and stories analytics' },
      { icon: '📈', label: 'Read reach, impressions, and engagement' },
      { icon: '👥', label: 'Read follower count and growth trends' },
      { icon: '💬', label: 'Read comments on your posts' },
    ],
    browserUrl: 'https://www.instagram.com/accounts/login/',
    browserCheck: 'https://www.instagram.com/',
  },
  {
    id: 'tiktok', name: 'TikTok', category: 'Social', authType: 'browser',
    color: '#010101',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect width="48" height="48" rx="10" fill="#010101"/><path d="M33 10c0 4.4 3.6 8 8 8v5c-2.8 0-5.4-.9-7.5-2.4V31a10 10 0 1 1-10-10v5a5 5 0 1 0 5 5V10h4.5z" fill="white"/><path d="M33 10c0 4.4 3.6 8 8 8v5c-2.8 0-5.4-.9-7.5-2.4V31a10 10 0 1 1-10-10v5a5 5 0 1 0 5 5V10H33z" fill="#69C9D0" opacity="0.7"/></svg>`,
    desc: 'Connect TikTok so Prom can pull your video performance, watch time, follower analytics, and hashtag data — full social coaching with real numbers.',
    permissions: [
      { icon: '🎥', label: 'Read video views, watch time, and shares' },
      { icon: '📈', label: 'Read follower growth and profile analytics' },
      { icon: '🏷️', label: 'Read hashtag and sound performance' },
    ],
    browserUrl: 'https://www.tiktok.com/login',
    browserCheck: 'https://www.tiktok.com/',
  },
  {
    id: 'x', name: 'X / Twitter', category: 'Social', authType: 'browser',
    color: '#000000',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect width="48" height="48" rx="10" fill="#000"/><path d="M8 8l13 15.5L8 40h4l11-12.5L33 40h7L26.5 23.5 40 8h-4L23 19.5 15 8z" fill="white"/></svg>`,
    desc: 'Connect X so Prom can read your timeline, track mentions, pull engagement stats, and post on your behalf — all within your browser session.',
    permissions: [
      { icon: '📰', label: 'Read timeline and mentions' },
      { icon: '📊', label: 'Read tweet analytics and impressions' },
      { icon: '✉️', label: 'Post and reply (with your approval)' },
    ],
    browserUrl: 'https://x.com/i/flow/login',
    browserCheck: 'https://x.com/home',
  },
  {
    id: 'linkedin', name: 'LinkedIn', category: 'Social', authType: 'browser',
    color: '#0A66C2',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><rect width="48" height="48" rx="8" fill="#0A66C2"/><rect x="8" y="18" width="8" height="22" fill="white"/><circle cx="12" cy="11" r="4" fill="white"/><path d="M22 18h7v3c1-2 4-4 8-4 6 0 9 4 9 11v12h-8V29c0-3-1-5-4-5s-4 2-4 5v11h-8z" fill="white"/></svg>`,
    desc: 'Connect LinkedIn so Prom can read your feed, track post performance, pull connection data, and manage your professional presence.',
    permissions: [
      { icon: '📝', label: 'Read posts and engagement metrics' },
      { icon: '👥', label: 'Read connections and profile views' },
      { icon: '📤', label: 'Post content (with your approval)' },
    ],
    browserUrl: 'https://www.linkedin.com/login',
    browserCheck: 'https://www.linkedin.com/feed/',
  },
  {
    id: 'reddit', name: 'Reddit', category: 'Social', authType: 'oauth',
    color: '#FF4500',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><circle cx="24" cy="24" r="22" fill="#FF4500"/><circle cx="24" cy="26" r="12" fill="white"/><circle cx="19" cy="25" r="2.5" fill="#FF4500"/><circle cx="29" cy="25" r="2.5" fill="#FF4500"/><path d="M19 31c1.5 2 8.5 2 10 0" stroke="#FF4500" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="36" cy="16" r="3" fill="white"/><path d="M24 14c3-4 8-3 10 0" stroke="white" stroke-width="2" fill="none"/><circle cx="31" cy="11" r="2" fill="#FFD700"/></svg>`,
    desc: 'Connect Reddit so Prom can monitor subreddits, track mentions of your brand, research topics, and draft posts — for community intelligence and content research.',
    permissions: [
      { icon: '🔍', label: 'Read posts and comments from subreddits' },
      { icon: '📣', label: 'Monitor brand mentions' },
      { icon: '📝', label: 'Draft posts and comments (with approval)' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
  {
    id: 'google_drive', name: 'Drive', category: 'Storage', authType: 'oauth',
    color: '#0F9D58',
    logo: `<svg viewBox="0 0 48 48" width="24" height="24"><path d="M6 38l7-12 7 12z" fill="#0F9D58"/><path d="M18 14L32 38H4z" fill="#00832D" opacity="0.8"/><path d="M14 26h20l7 12H7z" fill="#0F9D58" opacity="0.9"/><path d="M28 14l13 24-7 0L21 14z" fill="#00AC47"/><path d="M20 14h16l7 12H27z" fill="#00AC47" opacity="0.85"/><path d="M6 38l14-24 8 13-7 11z" fill="#0F9D58"/></svg>`,
    desc: 'Connect Google Drive so Prom can read files, docs, and spreadsheets — giving it access to your documents, SOPs, and reference material.',
    permissions: [
      { icon: '📂', label: 'Read files, folders, and docs' },
      { icon: '✏️', label: 'Create and update files (with approval)' },
      { icon: '🔍', label: 'Search across your Drive' },
    ],
    browserUrl: null,
    browserCheck: null,
  },
];

// ── Connection state (backed by /api/connections) ───────────────────────────

let connectionsState = {}; // { [id]: { connected, connectedAt, tokenRef } }
let activeConnectorId = null;

async function loadConnectionsState() {
  try {
    const data = await api('/api/connections');
    connectionsState = data?.connections || {};
  } catch (e) {
    // Route not yet available (first boot before build) — degrade silently
    connectionsState = {};
    console.warn('[connections] Could not load state:', e?.message || e);
  }
  renderConnectionsGrid();
  updateConnectionsBadge();
}

function updateConnectionsBadge() {
  const count = Object.values(connectionsState).filter(c => c.connected).length;
  const badge = document.getElementById('connections-count-badge');
  if (badge) badge.textContent = count > 0 ? `${count} connected` : '';
}

function filterConnectors(query) {
  const q = (query || '').toLowerCase().trim();
  const grid = document.getElementById('connections-grid');
  if (!grid) return;
  grid.querySelectorAll('.conn-card').forEach(card => {
    const name = (card.title || '').toLowerCase();
    card.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

function renderConnectionsGrid() {
  const grid = document.getElementById('connections-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const q = (document.getElementById('connections-search')?.value || '').toLowerCase().trim();
  CONNECTORS.forEach(c => {
    const isConnected = !!connectionsState[c.id]?.connected;
    const card = document.createElement('div');
    card.className = 'conn-card' + (isConnected ? ' connected' : '');
    card.title = c.name + (isConnected ? ' — Connected' : '');
    card.innerHTML = `
      <div class="conn-card-logo" style="background:${c.color}18">${c.logo}</div>
      <div class="conn-card-name">${c.name}</div>
    `;
    card.style.display = (!q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)) ? '' : 'none';
    card.onclick = () => openConnectorView(c.id);
    grid.appendChild(card);
  });
}

// ── Connector detail view ───────────────────────────────────────────────────

function openConnectorView(id) {
  const c = CONNECTORS.find(x => x.id === id);
  if (!c) return;
  activeConnectorId = id;
  const isConnected = !!connectionsState[id]?.connected;

  // Logo
  document.getElementById('cv-logo').innerHTML = `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:${c.color}18">${c.logo}</div>`;
  document.getElementById('cv-name').textContent = c.name;
  document.getElementById('cv-category').textContent = c.category;
  document.getElementById('cv-desc').textContent = c.desc;

  // Status badge
  const badge = document.getElementById('cv-status-badge');
  badge.style.display = isConnected ? '' : 'none';

  // Permissions
  const permsEl = document.getElementById('cv-permissions');
  permsEl.innerHTML = c.permissions.map(p => `
    <div class="cv-perm-row">
      <div class="cv-perm-icon" style="background:${c.color}18;color:${c.color}">${p.icon}</div>
      <span>${p.label}</span>
    </div>
  `).join('');

  // Actions
  renderConnectorActions(c, isConnected);

  // Activity log
  loadConnectorActivity(id, isConnected);

  // Show the view — hide right panel topbar so it doesn't bleed through
  const view = document.getElementById('connector-view');
  view.style.display = 'flex';
  document.getElementById('chat-view').style.display = 'none';
  const topbar = document.getElementById('right-panel-topbar');
  if (topbar) topbar.style.visibility = 'hidden';
}

function closeConnectorView() {
  document.getElementById('connector-view').style.display = 'none';
  document.getElementById('chat-view').style.display = 'flex';
  const topbar = document.getElementById('right-panel-topbar');
  if (topbar) topbar.style.visibility = '';
  activeConnectorId = null;
}

function renderConnectorActions(c, isConnected) {
  const el = document.getElementById('cv-actions');

  if (isConnected) {
    el.innerHTML = `
      <button class="cv-btn-disconnect" onclick="disconnectConnector('${c.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Disconnect ${c.name}
      </button>
    `;
    return;
  }

  if (c.authType === 'oauth') {
    el.innerHTML = `
      <button class="cv-btn-connect" onclick="startOAuthFlow('${c.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        Connect with ${c.name}
      </button>
      <div style="font-size:11px;color:var(--muted);text-align:center">You'll be redirected to authorize Prometheus to access your ${c.name} account.</div>
    `;
  } else {
    // Browser login flow
    el.innerHTML = `
      <div id="browser-login-wrap-${c.id}" style="display:flex;flex-direction:column;gap:10px">
        <button class="cv-btn-connect" id="btn-browser-open-${c.id}" onclick="startBrowserLogin('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Open ${c.name} Login
        </button>
        <div id="browser-login-instructions-${c.id}" style="display:none;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:12.5px;color:var(--text);line-height:1.7">
          <div style="font-weight:700;margin-bottom:6px">🔐 Log in to ${c.name} in the browser window that just opened.</div>
          <ol style="margin:0;padding-left:18px;color:var(--muted)">
            <li>Enter your ${c.name} credentials in the browser</li>
            <li>Complete any 2FA steps</li>
            <li>Once you're logged in, <strong style="color:var(--text)">close the tab</strong></li>
            <li>Come back here and click <strong style="color:var(--text)">"Verify Login"</strong></li>
          </ol>
        </div>
        <button class="cv-btn-connect" id="btn-verify-login-${c.id}" style="display:none;background:var(--ok)" onclick="verifyBrowserLogin('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Verify Login
        </button>
        <div id="verify-status-${c.id}" style="font-size:11px;color:var(--muted);text-align:center;display:none"></div>
      </div>
    `;
  }
}

async function startOAuthFlow(id) {
  const c = CONNECTORS.find(x => x.id === id);
  const btn = document.querySelector(`#cv-actions .cv-btn-connect`);
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }

  try {
    const res = await api('/api/connections/oauth/start', { method: 'POST', body: JSON.stringify({ id }) });

    if (res?.needsSetup) {
      // Connector is wired but env vars not set yet — show setup instructions
      renderOAuthSetupInstructions(id, c, res.message);
      return;
    }

    if (res?.url) {
      // Real OAuth URL — open popup and start polling the dedicated poll endpoint
      window.open(res.url, '_blank', 'width=600,height=700');
      renderOAuthWaiting(id, c);
      pollOAuthCompletion(id);
    } else {
      renderOAuthManualFallback(id, c);
    }
  } catch (e) {
    renderOAuthManualFallback(id, c);
    console.warn('[oauth]', e.message);
  }
}

function renderOAuthWaiting(id, c) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  el.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:12px;height:12px;border-radius:50%;background:var(--brand);animation:pulse 1.2s infinite"></div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">Waiting for authorization…</div>
      </div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">
        Complete the login in the popup window.<br>
        This will update automatically when done.
      </div>
      <button class="cv-btn-disconnect" onclick="openConnectorView('${id}')" style="width:fit-content">Cancel</button>
    </div>
  `;
}

function renderOAuthSetupInstructions(id, c, serverMessage) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  const name = c?.name || id;

  // Map connector IDs to their env var names and setup URLs
  const setupInfo = {
    gmail:        { vars: 'GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET',        url: 'https://console.cloud.google.com/', steps: 'Enable Gmail API → OAuth 2.0 Client ID → Desktop app' },
    slack:        { vars: 'SLACK_CLIENT_ID, SLACK_CLIENT_SECRET',        url: 'https://api.slack.com/apps',        steps: 'Create App → OAuth & Permissions → Add scopes' },
    github:       { vars: 'GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET',      url: 'https://github.com/settings/applications/new', steps: 'New OAuth App → Callback: http://localhost:19422/auth/callback/github' },
    notion:       { vars: 'NOTION_CLIENT_ID, NOTION_CLIENT_SECRET',      url: 'https://www.notion.so/my-integrations', steps: 'New integration → Public → Redirect URI: http://localhost:19423/auth/callback/notion' },
    reddit:       { vars: 'REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET',      url: 'https://www.reddit.com/prefs/apps', steps: 'Create App → Redirect: http://localhost:19424/auth/callback/reddit' },
    google_drive: { vars: 'GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET',      url: 'https://console.cloud.google.com/', steps: 'Enable Drive API → same OAuth client as Gmail' },
    hubspot:      { vars: 'HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET',    url: 'https://developers.hubspot.com/',    steps: 'Create App → Auth → Redirect: http://localhost:19426/auth/callback/hubspot' },
    salesforce:   { vars: 'SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET', url: 'https://login.salesforce.com/',  steps: 'Setup → App Manager → New Connected App' },
    stripe:       { vars: 'STRIPE_RESTRICTED_KEY',                       url: 'https://dashboard.stripe.com/apikeys', steps: 'Create restricted key with read permissions' },
    ga4:          { vars: 'GA4_CLIENT_ID, GA4_CLIENT_SECRET',            url: 'https://console.cloud.google.com/', steps: 'Enable Analytics Reporting API → OAuth client' },
  };

  const info = setupInfo[id] || { vars: `${id.toUpperCase()}_CLIENT_ID, ${id.toUpperCase()}_CLIENT_SECRET`, url: '#', steps: 'See documentation' };

  el.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--warn);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:13px;font-weight:700;color:var(--warn)">⚙️ Setup Required — ${name}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.7">
        To connect ${name}, you need to register an OAuth app and set your credentials.
      </div>
      <div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:11.5px;line-height:1.8">
        <div style="font-weight:700;color:var(--text);margin-bottom:4px">Setup steps:</div>
        <div style="color:var(--muted)">1. Go to <a href="${info.url}" target="_blank" style="color:var(--brand)">${info.url}</a></div>
        <div style="color:var(--muted)">2. ${info.steps}</div>
        <div style="color:var(--muted)">3. Set environment variables:</div>
        <div style="font-family:monospace;color:var(--text);background:var(--panel);padding:6px 8px;border-radius:5px;margin-top:4px;font-size:11px">${info.vars}</div>
        <div style="color:var(--muted);margin-top:6px">4. Restart Prometheus, then click Connect again.</div>
      </div>
      <button class="cv-btn-connect" style="background:var(--ok)" onclick="markConnectorManual('${id}')">
        ✓ Already set up — mark as connected
      </button>
    </div>
  `;
}

function renderOAuthManualFallback(id, c) {
  const el = document.getElementById('cv-actions');
  if (!el) return;
  const name = c?.name || id;
  el.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text)">🔗 ${name}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">Could not start the OAuth flow. You can mark this as connected if you've already set up access.</div>
      <button class="cv-btn-connect" style="background:var(--ok)" onclick="markConnectorManual('${id}')">
        ✓ Mark as Connected
      </button>
    </div>
  `;
}

async function markConnectorManual(id) {
  try {
    await api('/api/connections/save', {
      method: 'POST',
      body: JSON.stringify({ id, authType: 'manual', verified: true })
    });
    connectionsState[id] = { connected: true, connectedAt: Date.now(), authType: 'manual' };
    renderConnectionsGrid();
    updateConnectionsBadge();
    openConnectorView(id);
    showToast('Connected', (CONNECTORS.find(c=>c.id===id)?.name || id) + ' marked as connected.', 'success');
  } catch (e) {
    showToast('Error', 'Could not save: ' + e.message, 'error');
  }
}

function pollOAuthCompletion(id) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > 120) {
      clearInterval(interval);
      renderOAuthManualFallback(id, CONNECTORS.find(c=>c.id===id));
      return;
    }
    try {
      // Use the dedicated poll endpoint — much faster than polling connections.json
      const data = await api(`/api/connections/oauth/poll?id=${encodeURIComponent(id)}`);
      if (data?.pending === false) {
        clearInterval(interval);
        if (data.success) {
          connectionsState = data.connections || connectionsState;
          if (!connectionsState[id]) connectionsState[id] = { connected: true, connectedAt: Date.now(), authType: 'oauth' };
          renderConnectionsGrid();
          updateConnectionsBadge();
          openConnectorView(id);
          showToast('Connected!', (CONNECTORS.find(c=>c.id===id)?.name || id) + ' connected successfully.', 'success');
        } else {
          renderOAuthManualFallback(id, CONNECTORS.find(c=>c.id===id));
          showToast('Connection failed', data.error || 'OAuth did not complete.', 'error');
        }
      }
    } catch {}
  }, 2000); // Poll every 2s (faster now that we have a dedicated endpoint)
}

async function startBrowserLogin(id) {
  const c = CONNECTORS.find(x => x.id === id);
  if (!c?.browserUrl) return;
  // Tell server to open the browser to the login page
  try {
    await api('/api/connections/browser-open', { method: 'POST', body: JSON.stringify({ id, url: c.browserUrl }) });
  } catch {}
  // Show instructions + verify button
  document.getElementById(`browser-login-instructions-${id}`).style.display = '';
  document.getElementById(`btn-verify-login-${id}`).style.display = 'flex';
  document.getElementById(`btn-browser-open-${id}`).textContent = '↻ Re-open Login Page';
}

async function verifyBrowserLogin(id) {
  const c = CONNECTORS.find(x => x.id === id);
  const statusEl = document.getElementById(`verify-status-${id}`);
  const btn = document.getElementById(`btn-verify-login-${id}`);
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  statusEl.style.display = '';
  statusEl.textContent = 'Checking browser session...';

  try {
    const res = await api('/api/connections/browser-verify', {
      method: 'POST',
      body: JSON.stringify({ id, checkUrl: c.browserCheck })
    });
    if (res?.verified) {
      // Save connection state
      await api('/api/connections/save', {
        method: 'POST',
        body: JSON.stringify({ id, authType: 'browser', verified: true })
      });
      connectionsState[id] = { connected: true, connectedAt: Date.now(), authType: 'browser' };
      renderConnectionsGrid();
      updateConnectionsBadge();
      openConnectorView(id);
      showToast('Connected!', c.name + ' connected via browser session.', 'success');
    } else {
      statusEl.style.color = 'var(--err)';
      statusEl.textContent = res?.message || 'Login not detected. Please log in and try again.';
      btn.disabled = false;
      btn.textContent = 'Verify Login';
    }
  } catch (e) {
    statusEl.style.color = 'var(--err)';
    statusEl.textContent = 'Verification failed: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Verify Login';
  }
}

async function disconnectConnector(id) {
  if (!confirm('Disconnect this connector? Prom will lose access until you reconnect.')) return;
  try {
    await api('/api/connections/disconnect', { method: 'POST', body: JSON.stringify({ id }) });
    delete connectionsState[id];
    renderConnectionsGrid();
    updateConnectionsBadge();
    openConnectorView(id);
    showToast('Disconnected', 'Connector removed successfully.', 'success');
  } catch (e) {
    showToast('Error', 'Could not disconnect: ' + e.message, 'error');
  }
}

async function loadConnectorActivity(id, isConnected) {
  const wrap = document.getElementById('cv-activity-wrap');
  const list = document.getElementById('cv-activity-list');
  const empty = document.getElementById('cv-activity-empty');
  const countEl = document.getElementById('cv-activity-count');

  if (!isConnected) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0">Loading activity...</div>';
  empty.style.display = 'none';

  try {
    const data = await api(`/api/connections/activity?id=${encodeURIComponent(id)}&limit=50`);
    const entries = data?.entries || [];
    countEl.textContent = entries.length ? `${entries.length} events` : '';
    if (entries.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    list.innerHTML = entries.map(e => {
      const dir = e.direction === 'in' ? 'IN' : 'OUT';
      const dirClass = e.direction === 'in' ? 'in' : 'out';
      const time = new Date(e.timestamp).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<div class="cv-activity-row">
        <span class="cv-activity-dir ${dirClass}">${dir}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.title || e.action || '')}</div>
          <div style="color:var(--muted);font-size:10.5px;margin-top:1px">${time}${e.summary ? ' — ' + escapeHtml(e.summary.slice(0,80)) : ''}</div>
        </div>
      </div>`;
    }).join('');
    empty.style.display = 'none';
  } catch {
    list.innerHTML = '';
    empty.style.display = '';
    empty.style.display = ''; empty.textContent = 'Could not load activity log.';
  }
}

// escapeHtml — using escHtml imported from utils.js
const escapeHtml = escHtml;


// Auto-load on module init
loadConnectionsState();

// ─── Expose on window for HTML onclick handlers ────────────────
window.loadConnectionsState = loadConnectionsState;
window.updateConnectionsBadge = updateConnectionsBadge;
window.filterConnectors = filterConnectors;
window.renderConnectionsGrid = renderConnectionsGrid;
window.openConnectorView = openConnectorView;
window.closeConnectorView = closeConnectorView;
window.renderConnectorActions = renderConnectorActions;
window.startOAuthFlow = startOAuthFlow;
window.renderOAuthWaiting = renderOAuthWaiting;
window.renderOAuthSetupInstructions = renderOAuthSetupInstructions;
window.renderOAuthManualFallback = renderOAuthManualFallback;
window.markConnectorManual = markConnectorManual;
window.pollOAuthCompletion = pollOAuthCompletion;
window.startBrowserLogin = startBrowserLogin;
window.verifyBrowserLogin = verifyBrowserLogin;
window.disconnectConnector = disconnectConnector;
window.loadConnectorActivity = loadConnectorActivity;
window.escapeHtml = escapeHtml;
