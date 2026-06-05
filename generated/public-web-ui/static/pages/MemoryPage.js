import { api, ENDPOINTS } from '../api.js';
import { escHtml, showToast } from '../utils.js';

const TYPE_COLORS = {
  chat_session: '#8cc8ff',
  chat_transcript: '#64b5f6',
  chat_compaction: '#5ec9a8',
  task_state: '#f7b267',
  proposal_state: '#ff9f9f',
  cron_run: '#f7d154',
  cron_job: '#ffd166',
  schedule_state: '#c792ea',
  team_state: '#66d9e8',
  project_state: '#8ce99a',
  memory_root: '#ffde7d',
  memory_note: '#f5a3ff',
  obsidian_note: '#8fddc7',
  workspace_file: '#9fb7ff',
  audit_misc: '#b0b8c9',
  unknown: '#b0b8c9',
};

const CATEGORY_META = {
  chats: { label: 'Chats', color: '#79b8ff' },
  thoughts: { label: 'Thoughts', color: '#35e8ff' },
  dreams: { label: 'Dreams', color: '#b58cff' },
  restarts: { label: 'Restarts', color: '#ff7a90' },
  proposals: { label: 'Proposals', color: '#ff96b8' },
  tasks: { label: 'Tasks', color: '#ffbe7a' },
  cron: { label: 'Cron', color: '#ffd76e' },
  schedules: { label: 'Schedules', color: '#c18eff' },
  teams: { label: 'Teams', color: '#69d5e8' },
  subagents: { label: 'Subagents', color: '#75a7ff' },
  subagentWorkspace: { label: 'Subagent Files', color: '#28d7c7' },
  projects: { label: 'Projects', color: '#8fe39d' },
  workspaceFiles: { label: 'Workspace Files', color: '#9fb7ff' },
  userMemory: { label: 'USER.md', color: '#46e6a8' },
  soulMemory: { label: 'SOUL.md', color: '#ff72d8' },
  memoryRoot: { label: 'MEMORY.md', color: '#ffe277' },
  manualMemory: { label: 'Manual Memories', color: '#f3a6ff' },
  memory: { label: 'Memory Files', color: '#f4b0ff' },
  obsidian: { label: 'Obsidian', color: '#8fddc7' },
  misc: { label: 'Other', color: '#aab4c5' },
};

const PARTICLE_MODES = ['galaxy', 'sphere', 'wave', 'tunnel'];
const DEFAULT_LAYOUT_KEY = 'prometheus-memory-default-layout';
const LEGACY_DEFAULT_SHAPE_KEY = 'prometheus-memory-default-shape';
const MEMORY_GRAPH_SETTINGS_KEY = 'prometheus-memory-graph-settings';
const MAX_MEMORY_ATTACHMENTS = 12;

function createMemoryDraft() {
  return {
    title: '',
    description: '',
    content: '',
    attachments: [],
    submitting: false,
  };
}

const state = {
  initialized: false,
  graphLoadedAt: 0,
  graphFetchPromise: null,
  canvas: null,
  ctx: null,
  stageEl: null,
  tooltipEl: null,
  emptyEl: null,
  detailEl: null,
  statsEl: null,
  controls: {
    typeFilter: '',
    search: '',
    minEdgeWeight: 0.34,
    showLabels: false,
    organizeByType: false,
    separateByType: false,
    visualMode: 'galaxy',
    speed: 35,
    depth: 740,
    glow: 20,
  },
  transform: { x: 0, y: 0, scale: 1 },
  scene: {
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    yaw: -0.35,
    pitch: 0.22,
    targetYaw: -0.35,
    targetPitch: 0.22,
    zoom: 1120,
    targetZoom: 1120,
    projected: [],
    burst: 0,
  },
  rawNodes: [],
  rawEdges: [],
  recordNodes: [],
  realEdges: [],
  renderNodes: [],
  renderEdges: [],
  typeGroupCards: [],
  nodeById: new Map(),
  recordNodeById: new Map(),
  visibleAdjacency: new Map(),
  hoverNodeId: null,
  selectedNodeId: null,
  detailCache: new Map(),
  dragState: null,
  pointers: new Map(),
  controlsCollapsed: true,
  drawerMode: 'detail',
  memoryDraft: createMemoryDraft(),
  shapeMode: 'prometheus',
  dragOverDropzone: false,
  imagePoints: null,
  shuffleTimer: 0,
  simulationHeat: 1,
  raf: 0,
  resizeObserver: null,
  spriteCache: new Map(),
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hashString(input) { let hash = 5381; for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash) ^ input.charCodeAt(i); return Math.abs(hash); }
function currentParticleModeLabel() {
  const mode = PARTICLE_MODES.includes(state.controls.visualMode) ? state.controls.visualMode : 'galaxy';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
function flameNodePath(ctx, cx, cy, r) {
  // Flame shape centered at (cx, cy), tip pointing up. r is the effective radius.
  const s = r * 1.25;
  ctx.moveTo(cx, cy - s * 1.05);
  ctx.bezierCurveTo(cx + s * 0.58, cy - s * 0.55, cx + s * 0.82, cy + s * 0.12, cx + s * 0.42, cy + s * 0.58);
  ctx.bezierCurveTo(cx + s * 0.22, cy + s * 0.88, cx - s * 0.22, cy + s * 0.88, cx - s * 0.42, cy + s * 0.58);
  ctx.bezierCurveTo(cx - s * 0.82, cy + s * 0.12, cx - s * 0.58, cy - s * 0.55, cx, cy - s * 1.05);
}
function roundedRectPath(ctx, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}
function sourceColor(type) { return TYPE_COLORS[type] || TYPE_COLORS.unknown; }
function rgbFromColor(color) {
  const hex = String(color || '#ffffff').replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex.padEnd(6, 'f');
  const int = parseInt(expanded.slice(0, 6), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
function alpha(color, opacity) {
  const hex = String(color || '#ffffff').replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex.padEnd(6, 'f');
  const [r, g, b] = rgbFromColor(color);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
function formatTime(ts) { if (!ts) return 'Unknown'; const parsed = Date.parse(ts); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : ts; }
function normalizedMemoryPath(raw) {
  return String(raw?.sourcePath || raw?.path || '').replace(/\\/g, '/');
}

function toCategoryId(rawInput) {
  const raw = typeof rawInput === 'object' && rawInput ? rawInput : { sourceType: rawInput };
  const type = String(raw.sourceType || '').toLowerCase();
  const sourcePath = normalizedMemoryPath(raw);
  const pathLower = sourcePath.toLowerCase();
  const label = String(raw.label || raw.title || '').toLowerCase();
  const summary = String(raw.summary || '').toLowerCase();
  const haystack = [type, pathLower, label, summary].join(' ');

  if (/memory\/root\/user\.md$/i.test(sourcePath) || /(^|\/)user\.md$/i.test(sourcePath)) return 'userMemory';
  if (/memory\/root\/soul\.md$/i.test(sourcePath) || /(^|\/)soul\.md$/i.test(sourcePath)) return 'soulMemory';
  if (/memory\/root\/memory\.md$/i.test(sourcePath) || /(^|\/)memory\.md$/i.test(sourcePath)) return 'memoryRoot';
  if (pathLower.startsWith('memory/files/curated-claims/')) return 'memory';
  if (pathLower.startsWith('memory/files/')) return 'manualMemory';

  if (pathLower.startsWith('restarts/') || /\brestart(s|ed|ing)?\b/.test(haystack) || type === 'hot_restart') return 'restarts';
  if (/brain\/(thoughts?|pulses?)\//.test(pathLower) || /(^|[\s_-])thought(s)?([\s_-]|$)/.test(haystack) || /-thought\.md$/.test(pathLower)) return 'thoughts';
  if (/brain\/(dreams?|cleanups?)\//.test(pathLower) || /(^|[\s_-])(dreams?|cleanups?|cleanup)([\s_-]|$)/.test(haystack)) return 'dreams';

  if (pathLower.includes('/subagents/') || pathLower.startsWith('subagents/') || pathLower.includes('.prometheus/subagents/')) {
    if (pathLower.includes('/workspace/') || pathLower.includes('/workspaces/') || /(^|\/)(files|artifacts|uploads)\//.test(pathLower)) return 'subagentWorkspace';
    return 'subagents';
  }
  if (/\bsubagent\b/.test(haystack)) {
    if (/\b(workspace|file|artifact|upload)\b/.test(haystack)) return 'subagentWorkspace';
    return 'subagents';
  }

  if (type.startsWith('chat_')) return 'chats';
  if (type.startsWith('proposal_')) return 'proposals';
  if (type.startsWith('task_')) return 'tasks';
  if (type.startsWith('cron_')) return 'cron';
  if (type.startsWith('schedule_')) return 'schedules';
  if (type.startsWith('team_')) return 'teams';
  if (type.startsWith('project_')) return 'projects';
  if (type === 'workspace_file' || pathLower.startsWith('workspace/files/')) return 'workspaceFiles';
  if (type.startsWith('memory_')) return 'memory';
  if (type.startsWith('obsidian_')) return 'obsidian';
  return 'misc';
}

function uiToWorld(clientX, clientY) {
  const rect = state.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.transform.x) / state.transform.scale,
    y: (clientY - rect.top - state.transform.y) / state.transform.scale,
  };
}

function getVisibleRecordCount() { return state.recordNodes.reduce((sum, node) => sum + (node.visible ? 1 : 0), 0); }
function getMatchedNodeCount() { return state.recordNodes.reduce((sum, node) => sum + (node.matched ? 1 : 0), 0); }
function updateStatsText(extra = '') {
  if (!state.statsEl) return;
  const modeLabel = state.controls.separateByType ? 'separated by type' : state.controls.organizeByType ? 'organized by type' : state.shapeMode === 'image' ? 'image' : currentParticleModeLabel().toLowerCase();
  const suffix = extra ? ' | ' + extra : '';
  state.statsEl.textContent = getVisibleRecordCount() + ' nodes | ' + modeLabel + suffix;
}

function buildAdjacency(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  return adjacency;
}

function getFollowers(nodeId, depth = 2) {
  const seen = new Set([nodeId]);
  let frontier = new Set([nodeId]);
  for (let step = 0; step < depth; step += 1) {
    const next = new Set();
    frontier.forEach((id) => {
      const neighbors = state.visibleAdjacency.get(id) || new Set();
      neighbors.forEach((neighborId) => {
        if (!seen.has(neighborId)) {
          seen.add(neighborId);
          next.add(neighborId);
        }
      });
    });
    frontier = next;
    if (!frontier.size) break;
  }
  return seen;
}

function controlsPanelEl() { return document.getElementById('memory-side-panel'); }
function controlsFabEl() { return document.getElementById('memory-controls-fab'); }
function detailDrawerEl() { return document.getElementById('memory-detail-drawer'); }
function drawerTitleEl() { return document.getElementById('memory-drawer-title'); }
function imageInputEl() { return document.getElementById('memory-image-input'); }
function dropOverlayEl() { return document.getElementById('memory-drop-overlay'); }

function setDrawerTitle(label) {
  const el = drawerTitleEl();
  if (el) el.textContent = label;
}

function setControlsCollapsed(collapsed) {
  state.controlsCollapsed = !!collapsed;
  const panel = controlsPanelEl();
  const fab = controlsFabEl();
  if (panel) panel.classList.toggle('collapsed', state.controlsCollapsed);
  if (fab) fab.style.display = state.controlsCollapsed ? 'inline-flex' : 'none';
}

function openMemoryDetailDrawer() {
  const drawer = detailDrawerEl();
  if (drawer) drawer.style.display = 'flex';
}

function closeMemoryDetailDrawer() {
  const drawer = detailDrawerEl();
  if (drawer) drawer.style.display = 'none';
  state.selectedNodeId = null;
  state.drawerMode = 'detail';
  state.memoryDraft = createMemoryDraft();
  setDrawerTitle('Node Detail');
  renderDetail(null);
}

function resetNodePhysics(node) {
  node.vx = 0;
  node.vy = 0;
  node.x = node.baseX;
  node.y = node.baseY;
  node.sleeping = false;
}

function stopNode(node) {
  if (!node) return;
  node.vx = 0;
  node.vy = 0;
  node.sleeping = false;
}

function snapNodesToBase(nodes) {
  nodes.forEach((node) => {
    node.x = node.baseX;
    node.y = node.baseY;
    node.vx = 0;
    node.vy = 0;
    node.sleeping = true;
  });
}

function wakeSimulation(intensity = 1) {
  state.simulationHeat = Math.max(state.simulationHeat, intensity);
  state.renderNodes.forEach((node) => { node.sleeping = false; });
}

function resolveClusterOverlap(nodeIds, iterations = 10) {
  const members = [...nodeIds]
    .map((id) => state.recordNodeById.get(id))
    .filter((node) => node && node.visible && !node.isHub);
  if (members.length < 2) return;

  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        let dx = b.baseX - a.baseX;
        let dy = b.baseY - a.baseY;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) {
          const angle = ((hashString(`${a.id}:${b.id}:cluster`) % 360) * Math.PI) / 180;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const minDist = a.radius + b.radius + 7;
        if (dist >= minDist) continue;
        const push = (minDist - dist) * 0.52;
        const ox = (dx / dist) * push;
        const oy = (dy / dist) * push;
        a.baseX -= ox;
        a.baseY -= oy;
        b.baseX += ox;
        b.baseY += oy;
        moved = true;
      }
    }
    if (!moved) break;
  }

  members.forEach((node) => {
    node.vx = 0;
    node.vy = 0;
    node.sleeping = false;
  });
}

function layoutByComponents(nodes, edges) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(edges);
  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const component = [];
    seen.add(node.id);
    while (stack.length) {
      const current = stack.pop();
      const item = nodeMap.get(current);
      if (!item) continue;
      component.push(item);
      (adjacency.get(current) || new Set()).forEach((neighborId) => {
        if (!seen.has(neighborId) && nodeMap.has(neighborId)) {
          seen.add(neighborId);
          stack.push(neighborId);
        }
      });
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  const dense = components.filter((component) => component.length > 1);
  const singles = components.filter((component) => component.length === 1).map((component) => component[0]);

  dense.forEach((component, groupIndex) => {
    const angle = (Math.PI * 2 * groupIndex) / Math.max(1, dense.length);
    const centerX = Math.cos(angle) * (220 + Math.min(420, groupIndex * 46));
    const centerY = Math.sin(angle) * (160 + Math.min(240, groupIndex * 24));
    component.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    component.forEach((node, index) => {
      const ring = Math.floor(index / 12);
      const step = index % 12;
      const localAngle = (Math.PI * 2 * step) / 12 + (hashString(node.id) % 360) * (Math.PI / 180);
      const spread = 34 + ring * 34 + (hashString(`${node.id}:spread`) % 9);
      node.baseX = centerX + Math.cos(localAngle) * spread;
      node.baseY = centerY + Math.sin(localAngle) * (spread * 0.78);
      resetNodePhysics(node);
    });
  });

  singles.sort((a, b) => a.label.localeCompare(b.label));
  singles.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, singles.length);
    const radius = 480 + Math.floor(index / 28) * 48;
    node.baseX = Math.cos(angle) * radius;
    node.baseY = Math.sin(angle) * radius * 0.72;
    resetNodePhysics(node);
  });
}

function layoutByRandomShape(nodes, kind = 'constellation') {
  const width = 860;
  const height = 560;
  const count = Math.max(1, nodes.length);
  nodes.forEach((node, index) => {
    let x = 0;
    let y = 0;
    if (kind === 'ring') {
      const angle = (Math.PI * 2 * index) / count;
      const radius = 120 + (index % 5) * 34;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
    } else if (kind === 'diamond') {
      const rowSize = Math.ceil(Math.sqrt(count));
      const col = index % rowSize;
      const row = Math.floor(index / rowSize);
      const px = (col - rowSize / 2) * 28;
      const py = (row - rowSize / 2) * 28;
      x = px + py * 0.55;
      y = py - px * 0.55;
    } else if (kind === 'flower') {
      const angle = (Math.PI * 2 * index) / count;
      const petals = 6;
      const radius = 120 + Math.sin(angle * petals) * 84;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
    } else if (kind === 'shell') {
      const t = index / count;
      const angle = t * Math.PI * 7.5;
      const radius = 22 + 260 * Math.pow(t, 0.82);
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.78;
    } else if (kind === 'bands') {
      const bands = 5;
      const band = index % bands;
      const slot = Math.floor(index / bands);
      x = (slot * 22) - width / 4;
      y = (band - (bands - 1) / 2) * 78 + Math.sin(slot * 0.35 + band) * 18;
    } else if (kind === 'wave') {
      const col = index % Math.ceil(Math.sqrt(count));
      const row = Math.floor(index / Math.ceil(Math.sqrt(count)));
      x = (col * 26) - width / 4;
      y = Math.sin(col * 0.55) * 80 + row * 18 - height / 4;
    } else if (kind === 'spiral') {
      const angle = index * 0.34;
      const radius = 12 + index * 2.4;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
    } else if (kind === 'helix') {
      const t = index / count;
      const angle = t * Math.PI * 10;
      const strand = index % 2 === 0 ? 1 : -1;
      x = strand * (60 + Math.sin(angle) * 20);
      y = t * height - height / 2;
    } else if (kind === 'grid') {
      const cols = Math.ceil(Math.sqrt(count * 1.4));
      const col = index % cols;
      const row = Math.floor(index / cols);
      const totalRows = Math.ceil(count / cols);
      x = (col - cols / 2) * 36;
      y = (row - totalRows / 2) * 36;
    } else if (kind === 'vortex') {
      const t = 1 - index / count;
      const angle = index * 0.52;
      const radius = 30 + t * 300;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.7;
    } else if (kind === 'hexgrid') {
      const cols = Math.ceil(Math.sqrt(count * 1.2));
      const col = index % cols;
      const row = Math.floor(index / cols);
      const totalRows = Math.ceil(count / cols);
      const xOff = row % 2 === 0 ? 0 : 20;
      x = (col - cols / 2) * 40 + xOff;
      y = (row - totalRows / 2) * 34;
    } else if (kind === 'cross') {
      const arm = index % 4;
      const pos = Math.floor(index / 4);
      const armLen = Math.ceil(count / 4);
      const t = pos / Math.max(1, armLen - 1);
      const r = 40 + t * 280;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      x = dirs[arm][0] * r;
      y = dirs[arm][1] * r;
    } else if (kind === 'pyramid') {
      let row = 0; let rowStart = 0; let rowSize = 1;
      while (rowStart + rowSize <= index) { rowStart += rowSize; row += 1; rowSize += 1; }
      const posInRow = index - rowStart;
      x = (posInRow - (rowSize - 1) / 2) * 38;
      y = row * 38 - (Math.sqrt(count * 2) / 3) * 38;
    } else if (kind === 'flame') {
      const H = Math.max(180, Math.min(500, 110 + Math.sqrt(count) * 22));
      const W = H * 0.64;
      const flameHalfW2 = (t) => W * Math.pow(t, 0.42) * (0.88 + 0.22 * Math.pow(1 - t, 1.6));
      const r1 = (hashString(`${node.id}:flm:t`) % 10000) / 10000;
      const r2 = (hashString(`${node.id}:flm:x`) % 10000) / 10000;
      const t = Math.pow(r1, 0.6);
      x = (r2 * 2 - 1) * flameHalfW2(t);
      y = -H + t * H * 1.9;
    } else {
      x = ((hashString(`${node.id}:shuffle:x`) % width) - width / 2) * 0.9;
      y = ((hashString(`${node.id}:shuffle:y`) % height) - height / 2) * 0.9;
    }
    node.baseX = x;
    node.baseY = y;
    node.sleeping = false;
  });

  // Push apart any overlapping nodes after layout
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.baseX - a.baseX;
        let dy = b.baseY - a.baseY;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = 1; dy = 0; dist = 1; }
        const minDist = (a.radius || 8) + (b.radius || 8) + 6;
        if (dist >= minDist) continue;
        const push = (minDist - dist) * 0.5;
        a.baseX -= (dx / dist) * push;
        a.baseY -= (dy / dist) * push;
        b.baseX += (dx / dist) * push;
        b.baseY += (dy / dist) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function layoutPrometheus(nodes) {
  if (!nodes.length) return;
  const count = nodes.length;

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacing = clamp(520 / Math.max(cols, rows), 9, 24);
  const sortedNodes = [...nodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));

  sortedNodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const jitterX = ((hashString(`${node.id}:grid:x`) % 1000) / 1000 - 0.5) * spacing * 0.24;
    const jitterY = ((hashString(`${node.id}:grid:y`) % 1000) / 1000 - 0.5) * spacing * 0.24;
    node.baseX = (col - (cols - 1) / 2) * spacing + jitterX;
    node.baseY = (row - (rows - 1) / 2) * spacing + jitterY;
    node.sleeping = false;
  });

  // Push apart any overlapping nodes
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.baseX - a.baseX;
        let dy = b.baseY - a.baseY;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = 1; dy = 0; dist = 1; }
        const minDist = (a.radius || 8) + (b.radius || 8) + 6;
        if (dist >= minDist) continue;
        const push = (minDist - dist) * 0.5;
        a.baseX -= (dx / dist) * push;
        a.baseY -= (dy / dist) * push;
        b.baseX += (dx / dist) * push;
        b.baseY += (dy / dist) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function applyImageShapeToNodes(nodes, points) {
  if (!Array.isArray(points) || !points.length || !nodes.length) return false;
  const sortedNodes = [...nodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  const picked = [];
  const step = Math.max(1, Math.floor(points.length / sortedNodes.length));
  for (let i = 0; i < points.length && picked.length < sortedNodes.length; i += step) picked.push(points[i]);
  while (picked.length < sortedNodes.length) picked.push(points[picked.length % points.length]);

  const minX = Math.min(...picked.map((p) => p.x));
  const maxX = Math.max(...picked.map((p) => p.x));
  const minY = Math.min(...picked.map((p) => p.y));
  const maxY = Math.max(...picked.map((p) => p.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(860 / spanX, 560 / spanY) * 0.82;

  sortedNodes.forEach((node, index) => {
    const point = picked[index];
    node.baseX = (point.x - minX - spanX / 2) * scale;
    node.baseY = (point.y - minY - spanY / 2) * scale;
    node.sleeping = false;
  });
  return true;
}

function sortedCategoryEntries(nodes) {
  const grouped = new Map();
  nodes.forEach((node) => {
    const categoryId = node.categoryId || 'misc';
    if (!grouped.has(categoryId)) grouped.set(categoryId, []);
    grouped.get(categoryId).push(node);
  });
  const categoryOrder = Object.keys(CATEGORY_META);
  return Array.from(grouped.entries()).sort((a, b) => {
    const ai = categoryOrder.indexOf(a[0]);
    const bi = categoryOrder.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a[0].localeCompare(b[0]);
  });
}

function layoutByTypeGroups(nodes) {
  const entries = sortedCategoryEntries(nodes);
  const groupCount = Math.max(1, entries.length);
  return entries.map(([categoryId, items], groupIndex) => {
    const meta = CATEGORY_META[categoryId] || CATEGORY_META.misc;
    items.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    const typeCount = Math.max(1, items.length);
    items.forEach((node, itemIndex) => {
      node.typeGroupIndex = groupIndex;
      node.typeGroupCount = groupCount;
      node.typeLocalIndex = itemIndex;
      node.typeLocalT = typeCount <= 1 ? 0.5 : itemIndex / Math.max(1, typeCount - 1);
      node.typeCount = typeCount;
    });
    return { id: 'type-card:' + categoryId, categoryId, label: meta.label, count: items.length, color: meta.color };
  });
}

function layoutSeparatedTypeGroups(nodes) {
  const entries = sortedCategoryEntries(nodes);
  const groupCount = Math.max(1, entries.length);
  const columns = Math.max(2, Math.ceil(Math.sqrt(groupCount * 1.34)));
  const cards = [];
  entries.forEach(([categoryId, items], groupIndex) => {
    const meta = CATEGORY_META[categoryId] || CATEGORY_META.misc;
    items.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    const count = Math.max(1, items.length);
    const grid = Math.ceil(Math.sqrt(count));
    const clusterWidth = clamp(84 + grid * 12 + Math.sqrt(count) * 11, 112, 280);
    const clusterHeight = clamp(76 + Math.ceil(count / grid) * 12 + Math.sqrt(count) * 10, 94, 260);
    const row = Math.floor(groupIndex / columns);
    const col = groupIndex % columns;
    const x = (col - (columns - 1) / 2) * 310 + ((row % 2) ? 54 : 0);
    const y = (row - (Math.ceil(groupCount / columns) - 1) / 2) * 245;
    items.forEach((node, itemIndex) => {
      const gx = itemIndex % grid;
      const gy = Math.floor(itemIndex / grid);
      const jitterA = ((hashString(node.id + ':sep:a') % 1000) / 1000 - 0.5);
      const jitterB = ((hashString(node.id + ':sep:b') % 1000) / 1000 - 0.5);
      node.typeGroupIndex = groupIndex;
      node.typeGroupCount = groupCount;
      node.typeLocalIndex = itemIndex;
      node.typeLocalT = count <= 1 ? 0.5 : itemIndex / Math.max(1, count - 1);
      node.typeCount = count;
      node.baseX = x + (gx / Math.max(1, grid - 1) - 0.5) * clusterWidth * 0.72 + jitterA * 18;
      node.baseY = y + (gy / Math.max(1, Math.ceil(count / grid) - 1) - 0.5) * clusterHeight * 0.66 + jitterB * 18;
    });
    cards.push({ id: 'type-card:' + categoryId, categoryId, label: meta.label, count: items.length, color: meta.color });
  });
  return cards;
}

function fitGraphToViewport() {
  state.transform = { x: 0, y: 0, scale: 1 };
}

function rebuildRenderGraph(relayout = true) {
  const visibleNodes = state.recordNodes.filter((node) => node.visible);
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const filteredEdges = state.realEdges.filter((edge) => edge.visible && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  state.visibleAdjacency = buildAdjacency(filteredEdges);
  state.typeGroupCards = state.controls.separateByType ? layoutSeparatedTypeGroups(visibleNodes) : state.controls.organizeByType ? layoutByTypeGroups(visibleNodes) : [];
  state.renderNodes = [...visibleNodes];
  state.renderEdges = [...filteredEdges].sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  state.nodeById = new Map(state.renderNodes.map((node) => [node.id, node]));

  const ordered = [...state.renderNodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  ordered.forEach((node, index) => {
    const seed = hashString(node.id + ':particle');
    const colorPick = (hashString(node.id + ':hue') % 100) / 100;
    node.sceneIndex = index;
    node.sceneT = ordered.length <= 1 ? 0.5 : index / Math.max(1, ordered.length - 1);
    node.sceneSeed = seed;
    node.sceneHue = colorPick < 0.46 ? 'cyan' : colorPick < 0.78 ? 'ember' : 'pink';
    node.interactive = true;
    if (relayout || state.shapeMode !== 'image') {
      node.x = node.baseX || 0;
      node.y = node.baseY || 0;
    }
  });

  if (state.shapeMode === 'image' && state.imagePoints?.length && relayout) {
    applyImageShapeToNodes(ordered, state.imagePoints);
  }
}

function processGraph(data) {
  state.rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  state.rawEdges = Array.isArray(data.edges) ? data.edges : [];
  state.recordNodeById = new Map();
  state.recordNodes = state.rawNodes.map((raw) => {
    const degree = Number(raw.degree || 0);
    const radius = clamp(3 + Math.sqrt(Math.max(0, degree)) * 0.72 + Number(raw.durability || 0.5) * 2.4, 3, 13);
    const node = {
      ...raw,
      degree,
      radius,
      color: CATEGORY_META[toCategoryId(raw)]?.color || sourceColor(raw.sourceType),
      categoryId: toCategoryId(raw),
      virtual: false,
      interactive: true,
      isHub: false,
      visible: true,
      matched: true,
      highlighted: false,
      baseX: 0,
      baseY: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    state.recordNodeById.set(node.id, node);
    return node;
  });
  state.realEdges = state.rawEdges
    .filter((edge) => state.recordNodeById.has(edge.source) && state.recordNodeById.has(edge.target))
    .map((edge) => ({ ...edge, visible: true, virtual: false }));
  applyFilters({ relayout: true });
}

function applyFilters(options = {}) {
  const relayout = options.relayout !== false;
  const query = String(state.controls.search || '').trim().toLowerCase();
  const typeFilter = String(state.controls.typeFilter || '').trim();
  const minWeight = Number(state.controls.minEdgeWeight || 0);
  const queryTerms = query.split(/\s+/).filter(Boolean);

  state.recordNodes.forEach((node) => {
    const haystack = `${node.label} ${node.sourcePath} ${node.summary || ''} ${node.sourceTypeLabel || ''}`.toLowerCase();
    const queryMatch = !queryTerms.length || queryTerms.every((term) => haystack.includes(term));
    const typeMatch = !typeFilter || node.sourceType === typeFilter;
    node.matched = queryMatch;
    node.visible = queryMatch && typeMatch;
    node.highlighted = queryTerms.length > 0 && queryMatch;
  });

  state.realEdges.forEach((edge) => {
    const source = state.recordNodeById.get(edge.source);
    const target = state.recordNodeById.get(edge.target);
    edge.visible = !!source && !!target && source.visible && target.visible && Number(edge.weight || 0) >= minWeight;
  });

  const typeSelect = document.getElementById('memory-type-filter');
  if (typeSelect && typeSelect.options.length <= 1) {
    const seen = new Set(state.rawNodes.map((node) => node.sourceType).filter(Boolean));
    Array.from(seen).sort().forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = state.rawNodes.find((node) => node.sourceType === type)?.sourceTypeLabel || type;
      typeSelect.appendChild(option);
    });
    typeSelect.value = state.controls.typeFilter || '';
  }

  rebuildRenderGraph(relayout);
  if (relayout) fitGraphToViewport();
  if (state.hoverNodeId && !state.nodeById.get(state.hoverNodeId)?.visible) hideTooltip();
  updateStatsText(queryTerms.length ? 'search active' : '');
}

function hideTooltip() {
  state.hoverNodeId = null;
  if (state.tooltipEl) state.tooltipEl.style.display = 'none';
}

function tooltipHtml(node) {
  if (node.isHub) {
    return `<strong>${escHtml(node.label)}</strong><div class="meta">Type organizer hub</div><div class="body">${escHtml(node.summary || '')}</div>`;
  }
  return `<strong>${escHtml(node.label)}</strong><div class="meta">${escHtml(node.sourceTypeLabel || node.sourceType || 'Record')} | ${escHtml(formatTime(node.timestamp))}</div><div class="body">${escHtml(cleanReadableText(node.summary || node.sourcePath || 'No summary available yet.'))}</div>`;
}

function showTooltip(node, point) {
  if (!state.tooltipEl || !state.stageEl || !node) return;
  state.hoverNodeId = node.id;
  state.tooltipEl.innerHTML = tooltipHtml(node);
  const stageRect = state.stageEl.getBoundingClientRect();
  state.tooltipEl.style.left = `${clamp(point.x + 18, 12, stageRect.width - 292)}px`;
  state.tooltipEl.style.top = `${clamp(point.y + 18, 12, stageRect.height - 150)}px`;
  state.tooltipEl.style.display = 'block';
}

function getNodeAtPoint(clientX, clientY) {
  if (!state.canvas) return null;
  const rect = state.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestDist = Infinity;
  for (let i = state.scene.projected.length - 1; i >= 0; i -= 1) {
    const item = state.scene.projected[i];
    if (!item?.node?.visible || item.node.interactive === false) continue;
    const dist = Math.hypot(x - item.screenX, y - item.screenY);
    const hitRadius = Math.max(9, item.size + 8);
    if (dist <= hitRadius && dist < bestDist) {
      best = item.node;
      bestDist = dist;
    }
  }
  return best;
}

function particleColor(node, alphaValue) {
  if (state.controls.organizeByType) return alpha(CATEGORY_META[node.categoryId]?.color || node.color, alphaValue);
  if (node.sceneHue === 'cyan') return 'rgba(57,232,255,' + alphaValue + ')';
  if (node.sceneHue === 'pink') return 'rgba(255,79,216,' + alphaValue + ')';
  return 'rgba(255,106,26,' + alphaValue + ')';
}

function particleRgb(node) {
  if (state.controls.organizeByType) return rgbFromColor(CATEGORY_META[node.categoryId]?.color || node.color);
  if (node.sceneHue === 'cyan') return [57, 232, 255];
  if (node.sceneHue === 'pink') return [255, 79, 216];
  return [255, 106, 26];
}

function getParticleSprite(node, size, glow) {
  const [r, g, b] = particleRgb(node);
  const sizeBucket = Math.max(1, Math.round(size * 2) / 2);
  const glowBucket = Math.round(glow * 20) / 20;
  const key = r + ',' + g + ',' + b + ':' + sizeBucket + ':' + glowBucket;
  const cached = state.spriteCache.get(key);
  if (cached) return cached;
  if (state.spriteCache.size > 420) state.spriteCache.clear();
  const halo = sizeBucket * (4.8 + glowBucket * 9.5);
  const pad = 3;
  const dim = Math.ceil((halo + pad) * 2);
  const sprite = document.createElement('canvas');
  sprite.width = dim;
  sprite.height = dim;
  const ctx = sprite.getContext('2d');
  const c = dim / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, halo);
  grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
  grad.addColorStop(0.28, 'rgba(' + r + ',' + g + ',' + b + ',' + (glowBucket * 0.42) + ')');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, halo, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',1)';
  ctx.beginPath();
  ctx.arc(c, c, sizeBucket, 0, Math.PI * 2);
  ctx.fill();
  const out = { canvas: sprite, width: dim, height: dim };
  state.spriteCache.set(key, out);
  return out;
}

function renderDprForNodeCount(count) {
  const device = window.devicePixelRatio || 1;
  if (count > 2600) return Math.min(device, 1);
  if (count > 1400) return Math.min(device, 1.25);
  return Math.min(device, 1.5);
}

function edgeBudget() {
  const edgeCount = state.renderEdges.length;
  const nodeCount = state.renderNodes.length;
  if (state.controls.organizeByType) return Math.min(edgeCount, 420);
  if (nodeCount > 3200) return Math.min(edgeCount, 520);
  if (nodeCount > 1800) return Math.min(edgeCount, 820);
  if (nodeCount > 900) return Math.min(edgeCount, 1250);
  return Math.min(edgeCount, 1900);
}

function particlePosition(node, time) {
  const mode = PARTICLE_MODES.includes(state.controls.visualMode) ? state.controls.visualMode : 'galaxy';
  const depth = Number(state.controls.depth || 740);
  const count = Math.max(1, state.renderNodes.length);
  const seed = Number(node.sceneSeed || hashString(node.id));
  let index = Number(node.sceneIndex || 0);
  let t = Number(node.sceneT || 0);
  let x = 0; let y = 0; let z = 0;

  if (state.controls.separateByType) {
    x = node.baseX || 0;
    y = node.baseY || 0;
    z = Math.sin((node.sceneSeed || 1) * 0.01 + time) * 36;
  } else if (state.controls.organizeByType) {
    const groupCount = Math.max(1, Number(node.typeGroupCount || 1));
    const groupIndex = Number(node.typeGroupIndex || 0);
    const localIndex = Number(node.typeLocalIndex || 0);
    const typeCount = Math.max(1, Number(node.typeCount || 1));
    const localT = Number.isFinite(node.typeLocalT) ? node.typeLocalT : (typeCount <= 1 ? 0.5 : localIndex / Math.max(1, typeCount - 1));
    const groupAngle = (Math.PI * 2 * groupIndex) / groupCount;
    const wedge = (Math.PI * 2) / groupCount;
    const localHashA = ((hashString(node.id + ':type:a') % 1000) / 1000 - 0.5);
    const localHashB = ((hashString(node.id + ':type:b') % 1000) / 1000 - 0.5);

    const colorPhase = groupAngle * 0.18;
    const laneOffset = (groupIndex - (groupCount - 1) / 2) / Math.max(1, groupCount) * depth * 0.22;
    if (mode === 'galaxy') {
      const arm = (localIndex % 5) * (Math.PI * 2 / 5) + colorPhase;
      const radius = (0.1 + Math.sqrt(localT) * 0.88) * depth;
      const swirl = radius * 0.013 + time * 0.38 + arm + localHashA * 0.18;
      x = Math.cos(swirl) * radius + Math.cos(groupAngle) * laneOffset + localHashB * 18;
      y = Math.sin(seed * 2.1 + time) * 16 + Math.cos(radius * 0.02 + groupIndex) * 18;
      z = Math.sin(swirl) * radius + Math.sin(groupAngle) * laneOffset + localHashA * 18;
    } else if (mode === 'sphere') {
      const phi = Math.acos(1 - 2 * localT);
      const theta = Math.PI * (3 - Math.sqrt(5)) * localIndex + time * 0.22 + colorPhase;
      const radius = depth * (0.35 + 0.11 * Math.sin(time * 1.2 + seed));
      x = Math.cos(theta) * Math.sin(phi) * radius + Math.cos(groupAngle) * depth * 0.055;
      y = Math.cos(phi) * radius + localHashB * depth * 0.025;
      z = Math.sin(theta) * Math.sin(phi) * radius + Math.sin(groupAngle) * depth * 0.055;
    } else if (mode === 'wave') {
      const grid = Math.max(1, Math.ceil(Math.sqrt(typeCount)));
      const gx = (localIndex % grid) / grid - 0.5 + localHashA * 0.025;
      const gy = Math.floor(localIndex / grid) / grid - 0.5 + localHashB * 0.025;
      x = gx * depth * 1.42 + laneOffset;
      z = gy * depth * 1.42 + Math.sin(groupAngle) * depth * 0.08;
      y = Math.sin(gx * 18 + time * 2.1 + groupIndex * 0.34) * 42 + Math.cos(gy * 16 + time * 1.7) * 34;
    } else {
      const ring = localIndex % 80;
      const lane = ring / 80 * Math.PI * 2 + colorPhase + localHashA * 0.08;
      const travel = ((localT * 2 + time * 0.12) % 1);
      const radius = depth * (0.12 + 0.34 * travel) + laneOffset * 0.18;
      x = Math.cos(lane + time * 0.8) * radius;
      y = Math.sin(lane + time * 0.8) * radius;
      z = (travel - 0.5) * depth * 2.1 + localHashB * 30;
    }
  } else if (state.shapeMode === 'image' && state.imagePoints?.length) {
    x = node.baseX || 0;
    y = node.baseY || 0;
    z = Math.sin((node.sceneSeed || 1) * 0.01 + time) * 28;
  } else if (mode === 'galaxy') {
    const arm = (index % 5) * (Math.PI * 2 / 5);
    const radius = Math.sqrt(t) * depth * 0.95;
    const swirl = radius * 0.013 + time * 0.38 + arm;
    x = Math.cos(swirl) * radius + Math.sin(seed) * 20;
    y = Math.sin(seed * 2.1 + time) * 18 + Math.cos(radius * 0.02) * 22;
    z = Math.sin(swirl) * radius + Math.cos(seed) * 20;
  } else if (mode === 'sphere') {
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (3 - Math.sqrt(5)) * index + time * 0.22;
    const radius = depth * (0.38 + 0.12 * Math.sin(time * 1.2 + seed));
    x = Math.cos(theta) * Math.sin(phi) * radius;
    y = Math.cos(phi) * radius;
    z = Math.sin(theta) * Math.sin(phi) * radius;
  } else if (mode === 'wave') {
    const grid = Math.max(1, Math.ceil(Math.sqrt(count)));
    const gx = (index % grid) / grid - 0.5;
    const gy = Math.floor(index / grid) / grid - 0.5;
    x = gx * depth * 1.55;
    z = gy * depth * 1.55;
    y = Math.sin(gx * 18 + time * 2.1) * 42 + Math.cos(gy * 16 + time * 1.7) * 42;
  } else {
    const ring = index % 80;
    const lane = ring / 80 * Math.PI * 2;
    const travel = ((t * 2 + time * 0.12) % 1);
    const radius = depth * (0.12 + 0.34 * travel);
    x = Math.cos(lane + time * 0.8) * radius;
    y = Math.sin(lane + time * 0.8) * radius;
    z = (travel - 0.5) * depth * 2.1;
  }

  if (state.scene.burst > 0) {
    const b = state.scene.burst;
    x += (((seed % 200) / 100) - 1) * b * 240;
    y += ((((seed >> 3) % 200) / 100) - 1) * b * 240;
    z += ((((seed >> 7) % 200) / 100) - 1) * b * 240;
  }
  return { x, y, z };
}

function projectPosition(pos) {
  const scene = state.scene;
  const cy = Math.cos(scene.yaw); const sy = Math.sin(scene.yaw);
  const cp = Math.cos(scene.pitch); const sp = Math.sin(scene.pitch);
  let x = pos.x * cy - pos.z * sy;
  let z = pos.x * sy + pos.z * cy;
  let y = pos.y * cp - z * sp;
  z = pos.y * sp + z * cp;
  const cameraZ = scene.zoom;
  const perspective = cameraZ / (cameraZ + z);
  const sceneScale = 720 / Math.max(280, cameraZ);
  return { screenX: scene.width / 2 + x * perspective * sceneScale, screenY: scene.height / 2 + y * perspective * sceneScale, z, perspective, sceneScale };
}

function drawParticleBackground(ctx, width, height) {
  const g = ctx.createRadialGradient(width * 0.52, height * 0.46, 0, width * 0.52, height * 0.46, Math.max(width, height) * 0.72);
  g.addColorStop(0, '#101118');
  g.addColorStop(0.45, '#07080b');
  g.addColorStop(1, '#020203');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  const gap = 62;
  for (let x = width / 2 % gap; x < width; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = height / 2 % gap; y < height; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.restore();
}

function draw() {
  if (!state.ctx || !state.canvas || !state.stageEl) return;
  const width = state.stageEl.clientWidth || 1;
  const height = state.stageEl.clientHeight || 1;
  const dpr = renderDprForNodeCount(state.renderNodes.length);
  if (state.canvas.width !== Math.round(width * dpr) || state.canvas.height !== Math.round(height * dpr)) {
    state.canvas.width = Math.round(width * dpr);
    state.canvas.height = Math.round(height * dpr);
  }
  state.canvas.style.width = width + 'px';
  state.canvas.style.height = height + 'px';
  state.scene.width = width;
  state.scene.height = height;
  state.scene.dpr = dpr;
  const ctx = state.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawParticleBackground(ctx, width, height);

  const projected = [];
  for (const node of state.renderNodes) {
    node._projected = null;
    if (!node.visible) continue;
    const pos = particlePosition(node, state.scene.time);
    const item = { node, ...projectPosition(pos) };
    if (item.perspective <= 0 || item.screenX < -70 || item.screenX > width + 70 || item.screenY < -70 || item.screenY > height + 70) continue;
    item.alphaValue = clamp((item.perspective - 0.25) * 1.4, 0.08, 0.9);
    item.size = clamp((node.radius || 5) * item.perspective * 0.62, 1.2, 8.2);
    node._projected = item;
    projected.push(item);
  }
  state.scene.projected = projected;

  if (state.controls.separateByType && state.typeGroupCards.length) {
    const boundsByCategory = new Map();
    for (const item of state.scene.projected) {
      const categoryId = item.node.categoryId || 'misc';
      let bounds = boundsByCategory.get(categoryId);
      if (!bounds) {
        bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        boundsByCategory.set(categoryId, bounds);
      }
      const pad = Math.max(16, item.size * 3.4);
      bounds.minX = Math.min(bounds.minX, item.screenX - pad);
      bounds.minY = Math.min(bounds.minY, item.screenY - pad);
      bounds.maxX = Math.max(bounds.maxX, item.screenX + pad);
      bounds.maxY = Math.max(bounds.maxY, item.screenY + pad);
    }
    ctx.save();
    ctx.textBaseline = 'middle';
    state.typeGroupCards.forEach((card) => {
      const bounds = boundsByCategory.get(card.categoryId);
      if (!bounds || !Number.isFinite(bounds.minX)) return;
      const cardWidth = clamp(bounds.maxX - bounds.minX + 42, 116, width * 0.82);
      const cardHeight = clamp(bounds.maxY - bounds.minY + 52, 72, height * 0.72);
      const centerX = clamp((bounds.minX + bounds.maxX) / 2, cardWidth / 2 + 10, width - cardWidth / 2 - 10);
      const centerY = clamp((bounds.minY + bounds.maxY) / 2, cardHeight / 2 + 10, height - cardHeight / 2 - 10);
      const x = centerX - cardWidth / 2;
      const y = centerY - cardHeight / 2;
      ctx.beginPath();
      roundedRectPath(ctx, x, y, cardWidth, cardHeight, 14);
      ctx.fillStyle = alpha(card.color, 0.06);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(card.color, 0.34);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 18, y + 20, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = alpha(card.color, 0.94);
      ctx.fill();
      ctx.font = '800 11px Manrope, sans-serif';
      ctx.fillStyle = 'rgba(244,247,255,0.92)';
      ctx.fillText(card.label, x + 30, y + 19);
      ctx.font = '700 9px Manrope, sans-serif';
      ctx.fillStyle = 'rgba(214,224,240,0.72)';
      ctx.fillText(card.count + ' nodes', x + 30, y + 34);
    });
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const baseEdgeBudget = edgeBudget();
  for (let i = 0; i < state.renderEdges.length; i += 1) {
    const edge = state.renderEdges[i];
    if (!edge.visible) continue;
    const source = state.nodeById.get(edge.source);
    const target = state.nodeById.get(edge.target);
    const a = source?._projected;
    const b = target?._projected;
    if (!a || !b) continue;
    const linkedToHover = state.hoverNodeId && (edge.source === state.hoverNodeId || edge.target === state.hoverNodeId);
    const linkedToSelected = state.selectedNodeId && (edge.source === state.selectedNodeId || edge.target === state.selectedNodeId);
    if (!linkedToHover && !linkedToSelected && i >= baseEdgeBudget) continue;
    const opacity = linkedToSelected ? 0.5 : linkedToHover ? 0.42 : 0.045;
    ctx.strokeStyle = linkedToSelected ? 'rgba(255,255,255,' + opacity + ')' : linkedToHover ? 'rgba(116,244,255,' + opacity + ')' : 'rgba(57,232,255,' + opacity + ')';
    ctx.lineWidth = linkedToSelected ? 2 : linkedToHover ? 1.6 : 0.7;
    ctx.beginPath();
    ctx.moveTo(a.screenX, a.screenY);
    ctx.lineTo(b.screenX, b.screenY);
    ctx.stroke();
  }

  const glow = Number(state.controls.glow || 20) / 100;
  for (const item of state.scene.projected) {
    const node = item.node;
    const isSelected = node.id === state.selectedNodeId;
    const isHovered = node.id === state.hoverNodeId;
    const alphaValue = item.alphaValue * (node.highlighted ? 1.16 : state.controls.search && !node.matched ? 0.24 : 1);
    const size = item.size + (isSelected ? 3.2 : isHovered ? 1.6 : 0);
    const sprite = getParticleSprite(node, size, glow);
    ctx.globalAlpha = clamp(alphaValue * 1.15, 0, 1);
    ctx.drawImage(sprite.canvas, item.screenX - sprite.width / 2, item.screenY - sprite.height / 2, sprite.width, sprite.height);
    ctx.globalAlpha = 1;
    if (isSelected) {
      ctx.fillStyle = 'rgba(255,255,255,0.98)';
      ctx.beginPath();
      ctx.arc(item.screenX, item.screenY, Math.max(1.8, size * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    if (isSelected || isHovered) {
      ctx.lineWidth = isSelected ? 2 : 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,' + (isSelected ? 0.92 : 0.62) + ')';
      ctx.beginPath();
      ctx.arc(item.screenX, item.screenY, size, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (state.controls.showLabels) {
    ctx.save();
    ctx.font = '11px Manrope, sans-serif';
    ctx.textBaseline = 'middle';
    const maxLabels = Math.round(clamp(26 + state.scene.zoom / 18, 32, 92));
    state.scene.projected
      .filter((item) => item.node.highlighted || item.node.id === state.hoverNodeId || item.node.id === state.selectedNodeId || item.size > 4.6)
      .sort((a, b) => b.size - a.size)
      .slice(0, maxLabels)
      .forEach((item) => {
        ctx.fillStyle = item.node.id === state.selectedNodeId ? '#ffffff' : 'rgba(236,244,255,0.86)';
        ctx.fillText(item.node.label, item.screenX + item.size + 7, item.screenY);
      });
    ctx.restore();
  }
}

function stepSimulation() {
  const scene = state.scene;
  scene.time += (Number(state.controls.speed || 35) / 100) * 0.016;
  scene.yaw += (scene.targetYaw - scene.yaw) * 0.08;
  scene.pitch += (scene.targetPitch - scene.pitch) * 0.08;
  scene.zoom += (scene.targetZoom - scene.zoom) * 0.12;
  scene.burst *= 0.93;
}

function animate() { stepSimulation(); draw(); state.raf = requestAnimationFrame(animate); }

function decodeQuotedJson(value) {
  if (!value) return '';
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
}

function cleanReadableText(input, maxLength = 0) {
  const text = String(input || '').replace(/\r/g, '\n').trim();
  if (!text) return '';

  const extracted = [];
  const quotedFieldPattern = /"(content|summary|text|body|message|note|description)"\s*:\s*"((?:\\.|[^"])*)"/g;
  for (const match of text.matchAll(quotedFieldPattern)) {
    const decoded = decodeQuotedJson(match[2]).trim();
    if (decoded) extracted.push(decoded);
  }
  if (extracted.length) {
    const joined = extracted.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return maxLength && joined.length > maxLength ? `${joined.slice(0, maxLength - 3).trimEnd()}...` : joined;
  }

  const stripped = text
    .replace(/^#{2,6}\s*\[[^\]]+\]\s+\w+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!stripped) return '';
  return maxLength && stripped.length > maxLength ? `${stripped.slice(0, maxLength - 3).trimEnd()}...` : stripped;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function syncMemoryDraftFromForm() {
  if (state.drawerMode !== 'compose' || !state.detailEl) return;
  const titleInput = state.detailEl.querySelector('[data-memory-title]');
  const descriptionInput = state.detailEl.querySelector('[data-memory-description]');
  const contentInput = state.detailEl.querySelector('[data-memory-content]');
  state.memoryDraft.title = titleInput?.value || '';
  state.memoryDraft.description = descriptionInput?.value || '';
  state.memoryDraft.content = contentInput?.value || '';
}

function renderMemoryComposer() {
  if (!state.detailEl) return;
  state.drawerMode = 'compose';
  setDrawerTitle('Add Memory');
  const draft = state.memoryDraft;
  state.detailEl.innerHTML = `
    <form class="memory-compose-form" data-memory-compose-form>
      <div class="memory-compose-help">Create a durable memory node with a title, an optional description, the full memory text, and any supporting files.</div>
      <label class="memory-compose-field">
        <span class="memory-compose-label">Title</span>
        <input class="memory-compose-input" data-memory-title type="text" maxlength="140" placeholder="Give this memory a clear title" value="${escHtml(draft.title || '')}" />
      </label>
      <label class="memory-compose-field">
        <span class="memory-compose-label">Description</span>
        <input class="memory-compose-input" data-memory-description type="text" maxlength="220" placeholder="Short summary for previews and search results" value="${escHtml(draft.description || '')}" />
      </label>
      <label class="memory-compose-field">
        <span class="memory-compose-label">Memory</span>
        <textarea class="memory-compose-textarea" data-memory-content placeholder="Write the full memory here. This becomes the indexed node content.">${escHtml(draft.content || '')}</textarea>
      </label>
      <div class="memory-compose-field">
        <span class="memory-compose-label">Attachments</span>
        <div class="memory-compose-dropzone">
          <strong>Attach screenshots, PDFs, docs, spreadsheets, or anything else that belongs with this memory.</strong>
          <div class="memory-compose-help">Files will be stored under <code>workspace/uploads/memory/...</code> and linked to this note.</div>
          <button type="button" class="memory-compose-file-picker" data-memory-add-files>Select Files</button>
          <input data-memory-file-input type="file" multiple style="display:none" />
        </div>
        <div class="memory-compose-file-list">
          ${draft.attachments.length
            ? draft.attachments.map((attachment, index) => `
                <div class="memory-compose-file-item">
                  <div class="memory-compose-file-meta">
                    <strong>${escHtml(attachment.file.name)}</strong>
                    <span>${escHtml(attachment.file.type || 'file')} | ${escHtml(formatBytes(attachment.file.size || 0))}</span>
                  </div>
                  <button type="button" class="memory-compose-file-remove" data-memory-remove-attachment="${index}">Remove</button>
                </div>
              `).join('')
            : '<div class="memory-detail-empty">No files selected yet.</div>'}
        </div>
      </div>
      <div class="memory-compose-actions">
        <button type="button" class="memory-compose-file-remove" onclick="closeMemoryDetailDrawer()">Cancel</button>
        <button type="submit" class="memory-compose-submit"${draft.submitting ? ' disabled' : ''}>${draft.submitting ? 'Creating...' : 'Create Memory'}</button>
      </div>
    </form>
  `;
}

function openAddMemoryDrawer() {
  state.selectedNodeId = null;
  state.memoryDraft = createMemoryDraft();
  openMemoryDetailDrawer();
  setControlsCollapsed(true);
  renderMemoryComposer();
}

function removeDraftAttachment(index) {
  syncMemoryDraftFromForm();
  state.memoryDraft.attachments.splice(index, 1);
  renderMemoryComposer();
}

function addDraftFiles(fileList) {
  syncMemoryDraftFromForm();
  const files = Array.from(fileList || []).filter((file) => file instanceof File);
  if (!files.length) return;
  const slotsLeft = Math.max(0, MAX_MEMORY_ATTACHMENTS - state.memoryDraft.attachments.length);
  const nextFiles = files.slice(0, slotsLeft).map((file) => ({ file }));
  state.memoryDraft.attachments.push(...nextFiles);
  if (files.length > nextFiles.length) {
    showToast('Attachment limit reached', `Only the first ${MAX_MEMORY_ATTACHMENTS} files are kept per memory note.`, 'warning', 2400);
  }
  renderMemoryComposer();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.replace(/^data:[^;]+;base64,/, ''));
    };
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function centerOnNode(node) {
  if (!node || !state.stageEl) return;
  const width = state.stageEl.clientWidth || 1;
  const height = state.stageEl.clientHeight || 1;
  state.transform.x = width / 2 - node.x * state.transform.scale;
  state.transform.y = height / 2 - node.y * state.transform.scale;
}

async function openMemoryAttachment(absPath) {
  const target = String(absPath || '').trim();
  if (!target) return;
  try {
    await api(ENDPOINTS.OPEN_PATH, { method: 'POST', body: JSON.stringify({ path: target }) });
  } catch (err) {
    showToast('Open failed', err.message || 'Could not open attachment path.', 'error');
  }
}

async function submitMemoryDraft(event) {
  if (event?.preventDefault) event.preventDefault();
  syncMemoryDraftFromForm();
  const title = String(state.memoryDraft.title || '').trim();
  const description = String(state.memoryDraft.description || '').trim();
  const content = String(state.memoryDraft.content || '').trim();
  if (!title) {
    showToast('Title required', 'Give the memory a title before saving it.', 'warning');
    return;
  }
  if (!content && !description && state.memoryDraft.attachments.length === 0) {
    showToast('Nothing to save', 'Add memory text, a description, or at least one attachment.', 'warning');
    return;
  }

  state.memoryDraft.submitting = true;
  renderMemoryComposer();
  try {
    const attachments = await Promise.all(state.memoryDraft.attachments.map(async ({ file }) => ({
      name: file.name,
      mimeType: file.type || '',
      base64: await fileToBase64(file),
    })));
    const result = await api(ENDPOINTS.MEMORY_CREATE, {
      method: 'POST',
      body: JSON.stringify({ title, description, content, attachments }),
    });
    await fetchGraph();
    const createdNode = result?.recordId ? state.recordNodeById.get(result.recordId) : null;
    if (createdNode && !createdNode.visible) {
      state.controls.search = '';
      state.controls.typeFilter = '';
      const searchInput = document.getElementById('memory-search-input');
      const typeFilter = document.getElementById('memory-type-filter');
      if (searchInput) searchInput.value = '';
      if (typeFilter) typeFilter.value = '';
      applyFilters({ relayout: false });
    }
    showToast('Memory created', `${title} is now part of the memory graph.`, 'success', 2400);
    if (result?.recordId) {
      selectNode(result.recordId);
      const node = state.recordNodeById.get(result.recordId);
      if (node) centerOnNode(node);
    } else {
      closeMemoryDetailDrawer();
    }
  } catch (err) {
    state.memoryDraft.submitting = false;
    renderMemoryComposer();
    showToast('Create memory failed', err.message || 'Unknown error', 'error');
  }
}

async function loadDetail(recordId) {
  if (!recordId) return;
  if (state.detailCache.has(recordId)) return renderDetail(state.detailCache.get(recordId));
  const requestedId = recordId;
  try {
    const data = await api(ENDPOINTS.memoryRecord(recordId) + '?related=0');
    state.detailCache.set(recordId, data);
    if (state.selectedNodeId === requestedId) renderDetail(data);
  } catch (err) {
    if (state.selectedNodeId === requestedId) state.detailEl.innerHTML = '<div class="memory-detail-empty">' + escHtml(err.message || 'Failed to load record detail') + '</div>';
  }
}

function nodePreviewPayload(node) {
  if (!node) return null;
  const timestampMs = Date.parse(node.timestamp || '');
  return {
    success: true,
    layer: 'graph',
    record: {
      id: node.id,
      title: node.label || node.title || 'Untitled record',
      sourceType: node.sourceType || 'record',
      sourcePath: node.sourcePath || '',
      timestamp: node.timestamp || '',
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
      projectId: node.projectId || null,
      durability: node.durability || 0.5,
    },
    chunks: node.summary ? [{ id: node.id + ':preview', index: 0, text: node.summary }] : [],
    related: [],
    preview: true,
  };
}

function renderDetail(payload) {
  if (!state.detailEl) return;
  state.drawerMode = 'detail';
  setDrawerTitle('Node Detail');
  const record = payload?.record;
  if (!record) {
    state.detailEl.innerHTML = '<div class="memory-detail-empty">Select a record node to inspect its summary, source, and related records.</div>';
    return;
  }
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks.slice(0, 2) : [];
  const related = Array.isArray(payload?.related) ? payload.related.slice(0, 6) : [];
  const isPreview = payload?.preview === true;
  const noteAttachments = Array.isArray(payload?.noteMeta?.attachments) ? payload.noteMeta.attachments : [];
  function renderParagraphs(text) {
    const cleaned = cleanReadableText(text);
    if (!cleaned) return '<em>No content available.</em>';
    return escHtml(cleaned).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }
  const cleanedChunks = [];
  const seenChunkBodies = new Set();
  chunks.forEach((chunk) => {
    const cleaned = cleanReadableText(chunk?.text || '');
    const dedupeKey = cleaned.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!dedupeKey || seenChunkBodies.has(dedupeKey)) return;
    seenChunkBodies.add(dedupeKey);
    cleanedChunks.push({ ...chunk, text: cleaned });
  });
  const summaryText = cleanedChunks[0]?.text || '';
  const extraChunks = cleanedChunks.slice(1);
  state.detailEl.innerHTML = `
    <div class="memory-detail-heading"><div><h3>${escHtml(record.title || 'Untitled record')}</h3></div><div class="memory-detail-chip">${escHtml(record.sourceType || 'record')}</div></div>
    <div class="memory-detail-meta">
      <div><strong>Time</strong>${escHtml(formatTime(record.timestamp || ''))}</div>
      <div><strong>Project</strong>${escHtml(record.projectId || 'None')}</div>
      <div><strong>Durability</strong>${escHtml(String(Number(record.durability || 0).toFixed(2)))}</div>
      <div><strong>Source</strong>${escHtml(record.sourcePath || '')}</div>
    </div>
    ${isPreview ? '<div class="memory-detail-loading-row">Loading full record...</div>' : ''}
    <div class="memory-detail-section-title">Summary</div>
    <div class="memory-detail-summary">${summaryText ? renderParagraphs(summaryText) : '<em class="memory-detail-empty-inline">No indexed summary available for this record yet.</em>'}</div>
    ${extraChunks.length ? `<div class="memory-detail-section-title">Additional Chunks</div>${extraChunks.map((chunk) => `<div class="memory-detail-chunk">${renderParagraphs(String(chunk.text || '').slice(0, 520))}</div>`).join('')}` : ''}
    ${noteAttachments.length ? `<div class="memory-detail-section-title">Attachments</div><div class="memory-attachment-list">${noteAttachments.map((attachment) => `
      <div class="memory-attachment-item">
        <div class="memory-attachment-meta">
          <strong>${escHtml(attachment.name || 'Attachment')}</strong>
          <span>${escHtml(attachment.kind || 'file')}${attachment.sizeBytes ? ` | ${escHtml(formatBytes(attachment.sizeBytes))}` : ''}</span>
        </div>
        <button type="button" class="memory-attachment-open" data-memory-open-path="${escHtml(attachment.absPath || '')}">Open</button>
      </div>
    `).join('')}</div>` : ''}
    ${!isPreview ? `    <div class="memory-detail-section-title">Related Records</div>
    <div class="memory-related-list">
      ${related.map((item) => `<button type="button" class="memory-related-item" data-record-id="${escHtml(item.recordId)}"><strong>${escHtml(item.title || item.recordId)}</strong><div class="meta">${escHtml(item.sourceType || 'record')} | ${escHtml(formatTime(item.timestamp || ''))}</div><div class="body">${escHtml(cleanReadableText(item.preview || '', 200))}</div></button>`).join('') || '<div class="memory-detail-empty">No related records returned for this node.</div>'}
    </div>` : ''}
  `;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = state.recordNodeById.get(nodeId);
  if (!node) return renderDetail(null);
  openMemoryDetailDrawer();
  setControlsCollapsed(true);
  renderDetail(nodePreviewPayload(node));
  loadDetail(nodeId);
}

async function fetchGraph(options = {}) {
  if (!options.refreshIndex && state.graphFetchPromise) return state.graphFetchPromise;
  const promise = (async () => {
  if (options.refreshIndex === true) {
    updateStatsText('refreshing index');
    await api(ENDPOINTS.MEMORY_REFRESH, { method: 'POST', body: '{}' }).catch(() => null);
  }
  const data = await api(ENDPOINTS.MEMORY_GRAPH, { timeoutMs: 60000 });
  processGraph(data);
  // Freshly-created node objects start at (0,0). Always snap them to their layout
  // base positions so they don't have to spring out from the origin — that
  // "explosion" causes severe lag on large graphs and was especially visible on
  // re-fetches (stale refresh, parallel activate-time fetch) where the old
  // first-load-only gate did not apply.
  snapNodesToBase(state.renderNodes);
  state.simulationHeat = 0;
  state.graphLoadedAt = Date.now();
  if (state.emptyEl) state.emptyEl.style.display = state.recordNodes.length ? 'none' : 'flex';
  updateStatsText();
  draw();
  })();
  state.graphFetchPromise = promise;
  try {
    return await promise;
  } finally {
    if (state.graphFetchPromise === promise) state.graphFetchPromise = null;
  }
}

function explodeNodes(power = 4.8) {
  state.recordNodes.forEach((node) => {
    const angle = Math.atan2(node.y || node.baseY || 0, node.x || node.baseX || 0) + ((hashString(`${node.id}:burst`) % 60) - 30) * (Math.PI / 180);
    const velocity = power + (hashString(`${node.id}:vel`) % 18) / 10;
    node.vx += Math.cos(angle) * velocity;
    node.vy += Math.sin(angle) * velocity;
    node.sleeping = false;
  });
  wakeSimulation(1);
}

function commitLayoutMode(nextMode, relayout = true) {
  state.shapeMode = nextMode;
  rebuildRenderGraph(relayout);
  fitGraphToViewport();
  wakeSimulation(relayout ? 1 : 0.6);
  draw();
}

function loadImageShapeFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const sampleW = 220;
      const scale = sampleW / img.width;
      const sampleH = Math.max(100, Math.round(img.height * scale));
      canvas.width = sampleW;
      canvas.height = sampleH;
      ctx.clearRect(0, 0, sampleW, sampleH);
      ctx.drawImage(img, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      const points = [];
      for (let y = 0; y < sampleH; y += 2) {
        for (let x = 0; x < sampleW; x += 2) {
          const idx = (y * sampleW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (a > 20 && luminance < 190) points.push({ x, y });
        }
      }
      if (points.length < 30) {
        showToast('Image shape failed', 'Use a higher-contrast image so the outline is easier to sample.', 'warning');
        return;
      }
      state.imagePoints = points;
      explodeNodes(5.4);
      clearTimeout(state.shuffleTimer);
      state.shuffleTimer = setTimeout(() => {
        commitLayoutMode('image', true);
        showToast('Image shape applied', `${file.name} now defines the node outline.`, 'success', 2200);
        updateDefaultShapeBtn();
      }, 220);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function handlePointerMove(event) {
  if (!state.canvas) return;
  if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.dragState?.type === 'orbit') {
    const dx = event.clientX - state.dragState.lastX;
    const dy = event.clientY - state.dragState.lastY;
    if (Math.hypot(event.clientX - state.dragState.startClientX, event.clientY - state.dragState.startClientY) > 4) state.dragState.moved = true;
    state.dragState.lastX = event.clientX;
    state.dragState.lastY = event.clientY;
    state.scene.targetYaw += dx * 0.006;
    state.scene.targetPitch = clamp(state.scene.targetPitch + dy * 0.004, -1.25, 1.25);
    hideTooltip();
    return;
  }
  const node = getNodeAtPoint(event.clientX, event.clientY);
  if (!node) return hideTooltip();
  const rect = state.canvas.getBoundingClientRect();
  showTooltip(node, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function handlePointerDown(event) {
  if (!state.canvas) return;
  event.preventDefault();
  try { state.canvas.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const node = getNodeAtPoint(event.clientX, event.clientY);
  state.dragState = { type: 'orbit', nodeId: node?.interactive === false ? null : node?.id || null, startClientX: event.clientX, startClientY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  state.canvas.classList.add('is-dragging');
  hideTooltip();
}

function handlePointerUp(event) {
  if (event?.pointerId != null) {
    state.pointers.delete(event.pointerId);
    try { state.canvas?.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
  }
  if (state.dragState?.type === 'orbit') {
    const clickedNodeId = state.dragState.nodeId;
    const wasClick = !state.dragState.moved;
    state.dragState = null;
    if (state.canvas) state.canvas.classList.remove('is-dragging');
    if (wasClick && clickedNodeId) selectNode(clickedNodeId);
    return;
  }
  state.dragState = null;
  if (state.canvas) state.canvas.classList.remove('is-dragging');
}

function handleWheel(event) {
  if (!state.canvas) return;
  event.preventDefault();
  state.scene.targetZoom = clamp(state.scene.targetZoom + event.deltaY * 0.5, 300, 2600);
  hideTooltip();
}

function setMemoryParticleMode(mode) {
  if (!PARTICLE_MODES.includes(mode)) return;
  state.shapeMode = 'prometheus';
  state.controls.visualMode = mode;
  document.querySelectorAll('[data-memory-particle-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-memory-particle-mode') === mode);
  });
  updateStatsText();
}

function syncTypeModeControls() {
  const organizeToggle = document.getElementById('memory-organize-type');
  const separateToggle = document.getElementById('memory-separate-type');
  if (organizeToggle) organizeToggle.checked = !!state.controls.organizeByType;
  if (separateToggle) separateToggle.checked = !!state.controls.separateByType;
  document.querySelectorAll('[data-memory-particle-mode]').forEach((btn) => {
    btn.disabled = !!state.controls.separateByType;
  });
  document.querySelectorAll('.memory-particle-controls').forEach((panel) => {
    panel.classList.toggle('is-shape-disabled', !!state.controls.separateByType);
  });
}

function toggleMemoryControlsPanel() {
  setControlsCollapsed(!state.controlsCollapsed);
}

function clampControlNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function applyDepthZoomRecommendation() {
  const recommendedZoom = clamp(720 + Math.max(0, state.controls.depth - 460) * 1.42, 720, 1800);
  if (state.scene.targetZoom < recommendedZoom) state.scene.targetZoom = recommendedZoom;
}

function updateControlValue(inputEl, valueEl, value) {
  if (inputEl) inputEl.value = String(value);
  if (valueEl) valueEl.textContent = String(value);
}

function setNumericControl(key, rawValue, inputEl, valueEl) {
  const config = { speed: { min: 0, max: 200, fallback: 35 }, depth: { min: 160, max: 900, fallback: 740 }, glow: { min: 0, max: 100, fallback: 20 } }[key];
  if (!config) return;
  const next = Math.round(clampControlNumber(rawValue, config.min, config.max, config.fallback));
  state.controls[key] = next;
  updateControlValue(inputEl, valueEl, next);
  if (key === 'depth') applyDepthZoomRecommendation();
}

function bindEditableControlValue(valueEl, inputEl, key) {
  if (!valueEl || !inputEl || valueEl.dataset.editableBound === '1') return;
  valueEl.dataset.editableBound = '1';
  valueEl.tabIndex = 0;
  valueEl.setAttribute('role', 'button');
  valueEl.setAttribute('title', 'Click to type a value');
  const config = { speed: { min: 0, max: 200, step: 1 }, depth: { min: 160, max: 900, step: 10 }, glow: { min: 0, max: 100, step: 1 } }[key];
  const beginEdit = () => {
    if (valueEl.querySelector('input')) return;
    const current = String(state.controls[key] ?? inputEl.value ?? '');
    valueEl.innerHTML = '<input class="memory-control-value-input" type="number" min="' + config.min + '" max="' + config.max + '" step="' + config.step + '" value="' + escHtml(current) + '" />';
    const editor = valueEl.querySelector('input');
    editor?.focus();
    editor?.select();
    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      setNumericControl(key, editor?.value, inputEl, valueEl);
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      valueEl.textContent = String(state.controls[key] ?? inputEl.value ?? '');
    };
    editor?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    editor?.addEventListener('blur', commit);
  };
  valueEl.addEventListener('click', beginEdit);
  valueEl.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginEdit(); } });
}

function savedMemoryGraphSettings() {
  return {
    typeFilter: state.controls.typeFilter || '',
    search: state.controls.search || '',
    minEdgeWeight: clamp(Number(state.controls.minEdgeWeight || 0.34), 0, 1),
    showLabels: !!state.controls.showLabels,
    organizeByType: !!state.controls.organizeByType,
    separateByType: !!state.controls.separateByType,
    visualMode: PARTICLE_MODES.includes(state.controls.visualMode) ? state.controls.visualMode : 'galaxy',
    speed: clampControlNumber(state.controls.speed, 0, 200, 35),
    depth: clampControlNumber(state.controls.depth, 160, 900, 740),
    glow: clampControlNumber(state.controls.glow, 0, 100, 20),
  };
}

function applyMemoryGraphSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (typeof settings.typeFilter === 'string') state.controls.typeFilter = settings.typeFilter;
  if (typeof settings.search === 'string') state.controls.search = settings.search;
  if (Number.isFinite(Number(settings.minEdgeWeight))) state.controls.minEdgeWeight = clamp(Number(settings.minEdgeWeight), 0, 1);
  if (typeof settings.showLabels === 'boolean') state.controls.showLabels = settings.showLabels;
  if (typeof settings.organizeByType === 'boolean') state.controls.organizeByType = settings.organizeByType;
  if (typeof settings.separateByType === 'boolean') state.controls.separateByType = settings.separateByType;
  if (state.controls.separateByType) state.controls.organizeByType = true;
  if (PARTICLE_MODES.includes(settings.visualMode)) state.controls.visualMode = settings.visualMode;
  state.controls.speed = clampControlNumber(settings.speed, 0, 200, state.controls.speed);
  state.controls.depth = clampControlNumber(settings.depth, 160, 900, state.controls.depth);
  state.controls.glow = clampControlNumber(settings.glow, 0, 100, state.controls.glow);
}

function loadMemoryGraphSettings() {
  try { applyMemoryGraphSettings(JSON.parse(localStorage.getItem(MEMORY_GRAPH_SETTINGS_KEY) || 'null')); } catch { /* ignore invalid storage */ }
}

function saveMemoryGraphSettings() {
  try {
    localStorage.setItem(MEMORY_GRAPH_SETTINGS_KEY, JSON.stringify(savedMemoryGraphSettings()));
    showToast('Memory graph settings saved', 'Filters and graph controls will persist after restart.', 'success', 2200);
  } catch {
    showToast('Save failed', 'Could not persist memory graph settings.', 'error');
  }
}

function triggerMemoryImageInput() {
  imageInputEl()?.click();
}

function shuffleMemoryGraph() {
  const current = PARTICLE_MODES.indexOf(state.controls.visualMode);
  const nextMode = PARTICLE_MODES[(current + 1) % PARTICLE_MODES.length] || 'galaxy';
  state.scene.burst = 1;
  setMemoryParticleMode(nextMode);
}

function bindControls() {
  const searchInput = document.getElementById('memory-search-input');
  const typeFilter = document.getElementById('memory-type-filter');
  const edgeWeight = document.getElementById('memory-edge-weight');
  const edgeWeightValue = document.getElementById('memory-edge-weight-value');
  const showLabels = document.getElementById('memory-show-labels');
  const organizeByType = document.getElementById('memory-organize-type');
  const separateByType = document.getElementById('memory-separate-type');
  const speed = document.getElementById('memory-particle-speed');
  const speedValue = document.getElementById('memory-particle-speed-value');
  const depth = document.getElementById('memory-particle-depth');
  const depthValue = document.getElementById('memory-particle-depth-value');
  const glow = document.getElementById('memory-particle-glow');
  const glowValue = document.getElementById('memory-particle-glow-value');
  const saveSettings = document.getElementById('memory-save-settings');
  const imageInput = imageInputEl();
  if (searchInput) searchInput.value = state.controls.search || '';
  if (typeFilter) typeFilter.value = state.controls.typeFilter || '';
  if (edgeWeight) edgeWeight.value = String(Math.round(state.controls.minEdgeWeight * 100));
  if (edgeWeightValue) edgeWeightValue.textContent = state.controls.minEdgeWeight.toFixed(2) + '+';
  if (showLabels) showLabels.checked = !!state.controls.showLabels;
  if (organizeByType) organizeByType.checked = !!state.controls.organizeByType;
  if (separateByType) separateByType.checked = !!state.controls.separateByType;
  if (speed) speed.value = String(state.controls.speed);
  if (speedValue) speedValue.textContent = String(state.controls.speed);
  if (depth) depth.value = String(state.controls.depth);
  if (depthValue) depthValue.textContent = String(state.controls.depth);
  if (glow) glow.value = String(state.controls.glow);
  if (glowValue) glowValue.textContent = String(state.controls.glow);
  bindEditableControlValue(speedValue, speed, 'speed');
  bindEditableControlValue(depthValue, depth, 'depth');
  bindEditableControlValue(glowValue, glow, 'glow');
  document.querySelectorAll('[data-memory-particle-mode]').forEach((btn) => {
    const mode = btn.getAttribute('data-memory-particle-mode');
    btn.classList.toggle('active', mode === state.controls.visualMode);
    btn.addEventListener('click', () => { if (!state.controls.separateByType) setMemoryParticleMode(mode); });
  });
  searchInput?.addEventListener('input', () => { state.controls.search = searchInput.value || ''; applyFilters({ relayout: false }); });
  typeFilter?.addEventListener('change', () => { state.controls.typeFilter = typeFilter.value || ''; applyFilters({ relayout: true }); });
  edgeWeight?.addEventListener('input', () => { state.controls.minEdgeWeight = Number(edgeWeight.value || 0) / 100; if (edgeWeightValue) edgeWeightValue.textContent = state.controls.minEdgeWeight.toFixed(2) + '+'; applyFilters({ relayout: true }); });
  showLabels?.addEventListener('change', () => { state.controls.showLabels = !!showLabels.checked; });
  organizeByType?.addEventListener('change', () => {
    state.controls.organizeByType = !!organizeByType.checked;
    if (!state.controls.organizeByType) state.controls.separateByType = false;
    syncTypeModeControls();
    applyFilters({ relayout: true });
  });
  separateByType?.addEventListener('change', () => {
    state.controls.separateByType = !!separateByType.checked;
    if (state.controls.separateByType) state.controls.organizeByType = true;
    syncTypeModeControls();
    applyFilters({ relayout: true });
  });
  speed?.addEventListener('input', () => { setNumericControl('speed', speed.value, speed, speedValue); });
  depth?.addEventListener('input', () => { setNumericControl('depth', depth.value, depth, depthValue); });
  glow?.addEventListener('input', () => { setNumericControl('glow', glow.value, glow, glowValue); });
  saveSettings?.addEventListener('click', saveMemoryGraphSettings);
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    state.controls.organizeByType = false;
    state.controls.separateByType = false;
    syncTypeModeControls();
    loadImageShapeFromFile(file);
    imageInput.value = '';
  });
  state.detailEl?.addEventListener('click', (event) => {
    const addFilesButton = event.target.closest('[data-memory-add-files]');
    if (addFilesButton) { state.detailEl?.querySelector('[data-memory-file-input]')?.click(); return; }
    const removeAttachmentButton = event.target.closest('[data-memory-remove-attachment]');
    if (removeAttachmentButton) { const index = Number(removeAttachmentButton.getAttribute('data-memory-remove-attachment')); if (Number.isInteger(index) && index >= 0) removeDraftAttachment(index); return; }
    const openPathButton = event.target.closest('[data-memory-open-path]');
    if (openPathButton) { openMemoryAttachment(openPathButton.getAttribute('data-memory-open-path')); return; }
    const button = event.target.closest('[data-record-id]');
    if (!button) return;
    const recordId = button.getAttribute('data-record-id');
    if (!recordId) return;
    selectNode(recordId);
  });
  state.detailEl?.addEventListener('change', (event) => { const input = event.target.closest('[data-memory-file-input]'); if (!input) return; addDraftFiles(input.files); input.value = ''; });
  state.detailEl?.addEventListener('submit', (event) => { if (!event.target.closest('[data-memory-compose-form]')) return; submitMemoryDraft(event); });
}

function setupCanvas() {
  state.canvas = document.getElementById('memory-graph-canvas');
  state.ctx = state.canvas?.getContext('2d');
  state.stageEl = document.getElementById('memory-graph-stage');
  state.tooltipEl = document.getElementById('memory-graph-tooltip');
  state.emptyEl = document.getElementById('memory-graph-empty');
  state.detailEl = document.getElementById('memory-detail-panel');
  state.statsEl = document.getElementById('memory-graph-stats');
  if (!state.canvas || !state.ctx || !state.stageEl) return;
  state.canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  state.canvas.addEventListener('wheel', handleWheel, { passive: false });
  state.stageEl.addEventListener('dragenter', (event) => {
    event.preventDefault();
    state.dragOverDropzone = true;
    const overlay = dropOverlayEl();
    if (overlay) overlay.style.display = 'flex';
  });
  state.stageEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    const overlay = dropOverlayEl();
    if (overlay) overlay.style.display = 'flex';
  });
  state.stageEl.addEventListener('dragleave', (event) => {
    if (!state.stageEl.contains(event.relatedTarget)) {
      state.dragOverDropzone = false;
      const overlay = dropOverlayEl();
      if (overlay) overlay.style.display = 'none';
    }
  });
  state.stageEl.addEventListener('drop', (event) => {
    event.preventDefault();
    state.dragOverDropzone = false;
    const overlay = dropOverlayEl();
    if (overlay) overlay.style.display = 'none';
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    state.controls.organizeByType = false;
    state.controls.separateByType = false;
    syncTypeModeControls();
    loadImageShapeFromFile(file);
  });
  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(() => { draw(); });
    state.resizeObserver.observe(state.stageEl);
  } else {
    window.addEventListener('resize', draw);
  }
}

function readSavedDefaultLayout() {
  try {
    const raw = localStorage.getItem(DEFAULT_LAYOUT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore invalid storage */ }

  try {
    const legacy = localStorage.getItem(LEGACY_DEFAULT_SHAPE_KEY);
    if (!legacy) return null;
    const points = JSON.parse(legacy);
    if (!Array.isArray(points) || points.length < 30) return null;
    return { mode: 'image', points };
  } catch {
    return null;
  }
}

function loadSavedDefaultShape() {
  const saved = readSavedDefaultLayout();
  if (!saved || typeof saved !== 'object') return false;
  if (saved.mode === 'image' && Array.isArray(saved.points) && saved.points.length >= 30) {
    state.imagePoints = saved.points;
    state.shapeMode = 'image';
    updateDefaultShapeBtn();
    return true;
  }
  return false;
}

function updateDefaultShapeBtn() {
  const btn = document.getElementById('memory-set-default-btn');
  if (!btn) return;
  const saved = readSavedDefaultLayout();
  const canSaveCurrent = state.shapeMode === 'image' && state.imagePoints?.length;
  if (canSaveCurrent && !saved) { btn.textContent = 'Set Image Default'; btn.style.opacity = '1'; }
  else if (saved) { btn.textContent = 'Clear Image Default'; btn.style.opacity = '1'; }
  else { btn.textContent = 'Set Image Default'; btn.style.opacity = '0.4'; }
}

function toggleDefaultShape() {
  const saved = readSavedDefaultLayout();
  const canSaveImage = state.shapeMode === 'image' && state.imagePoints?.length;
  if (saved) {
    localStorage.removeItem(DEFAULT_LAYOUT_KEY);
    localStorage.removeItem(LEGACY_DEFAULT_SHAPE_KEY);
    state.shapeMode = 'prometheus';
    showToast('Default image cleared', 'Particle modes will be used on next load.', 'success', 2200);
  } else if (canSaveImage) {
    try {
      localStorage.setItem(DEFAULT_LAYOUT_KEY, JSON.stringify({ mode: 'image', points: state.imagePoints }));
      localStorage.removeItem(LEGACY_DEFAULT_SHAPE_KEY);
      showToast('Default image saved', 'This image layout will be used on every page load.', 'success', 2200);
    } catch {
      showToast('Save failed', 'Could not save to localStorage - image may be too large.', 'error');
    }
  } else {
    showToast('No image shape active', 'Upload an image first, then set it as default.', 'warning');
  }
  updateDefaultShapeBtn();
}

function init() {
  if (state.initialized && (!state.canvas || !state.canvas.isConnected || document.getElementById('memory-graph-canvas') !== state.canvas)) {
    memoryPageUnmount();
  }
  if (state.initialized) return;
  state.initialized = true;
  setupCanvas();
  loadMemoryGraphSettings();
  bindControls();
  syncTypeModeControls();
  setControlsCollapsed(true);
  loadSavedDefaultShape();
  if (state.detailEl) renderDetail(null);
  fetchGraph().catch((err) => {
    if (state.emptyEl) {
      state.emptyEl.style.display = 'flex';
      state.emptyEl.textContent = err.message || 'Failed to load memory graph';
    }
  });
  animate();
}

export async function refreshMemoryGraph(forceIndex = false) {
  try {
    await fetchGraph({ refreshIndex: !!forceIndex });
    showToast(forceIndex ? 'Memory graph refreshed' : 'Memory graph updated', '', 'success', 2200);
  } catch (err) {
    showToast('Memory graph refresh failed', err.message || 'Unknown error', 'error');
  }
}

export function memoryPageUnmount() {
  if (state.canvas) {
    state.canvas.removeEventListener('pointerdown', handlePointerDown);
    state.canvas.removeEventListener('wheel', handleWheel);
    state.canvas.classList.remove('is-dragging');
  }
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerUp);
  try { state.resizeObserver?.disconnect?.(); } catch { /* noop */ }
  if (state.raf) cancelAnimationFrame(state.raf);
  clearTimeout(state.shuffleTimer);
  state.initialized = false;
  state.canvas = null;
  state.ctx = null;
  state.stageEl = null;
  state.tooltipEl = null;
  state.emptyEl = null;
  state.detailEl = null;
  state.statsEl = null;
  state.dragState = null;
  state.pointers.clear();
  state.graphFetchPromise = null;
  state.resizeObserver = null;
  state.raf = 0;
}

export function memoryPageActivate() {
  const wasInitialized = state.initialized;
  init();
  // init() already kicks off the first fetchGraph; only refetch on later activates if stale.
  if (wasInitialized && (Date.now() - state.graphLoadedAt) > 45000) fetchGraph().catch(() => {});
  draw();
}

window.refreshMemoryGraph = refreshMemoryGraph;
window.memoryPageActivate = memoryPageActivate;
window.memoryPageUnmount = memoryPageUnmount;
window.toggleMemoryControlsPanel = toggleMemoryControlsPanel;
window.closeMemoryDetailDrawer = closeMemoryDetailDrawer;
window.openAddMemoryDrawer = openAddMemoryDrawer;
window.shuffleMemoryGraph = shuffleMemoryGraph;
window.triggerMemoryImageInput = triggerMemoryImageInput;
window.toggleDefaultShape = toggleDefaultShape;
window.saveMemoryGraphSettings = saveMemoryGraphSettings;
