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
  audit_misc: '#b0b8c9',
  unknown: '#b0b8c9',
};

const CATEGORY_META = {
  chats: { label: 'Chats', color: '#79b8ff' },
  proposals: { label: 'Proposals', color: '#ff96b8' },
  tasks: { label: 'Tasks', color: '#ffbe7a' },
  cron: { label: 'Cron', color: '#ffd76e' },
  schedules: { label: 'Schedules', color: '#c18eff' },
  teams: { label: 'Teams', color: '#69d5e8' },
  projects: { label: 'Projects', color: '#8fe39d' },
  memory: { label: 'Memory', color: '#f4b0ff' },
  misc: { label: 'Other', color: '#aab4c5' },
};

const state = {
  initialized: false,
  graphLoadedAt: 0,
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
    showLabels: true,
    organizeByType: false,
    repulsion: 90,
    linkStrength: 0.026,
    collision: 24,
  },
  transform: { x: 0, y: 0, scale: 1 },
  rawNodes: [],
  rawEdges: [],
  recordNodes: [],
  realEdges: [],
  renderNodes: [],
  renderEdges: [],
  nodeById: new Map(),
  recordNodeById: new Map(),
  visibleAdjacency: new Map(),
  hoverNodeId: null,
  selectedNodeId: null,
  detailCache: new Map(),
  dragState: null,
  controlsCollapsed: false,
  shapeMode: 'default',
  dragOverDropzone: false,
  imagePoints: null,
  shuffleTimer: 0,
  simulationHeat: 1,
  raf: 0,
  resizeObserver: null,
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hashString(input) { let hash = 5381; for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash) ^ input.charCodeAt(i); return Math.abs(hash); }
function sourceColor(type) { return TYPE_COLORS[type] || TYPE_COLORS.unknown; }
function alpha(color, opacity) {
  const hex = String(color || '#ffffff').replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex.padEnd(6, 'f');
  const int = parseInt(expanded.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
function formatTime(ts) { if (!ts) return 'Unknown'; const parsed = Date.parse(ts); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : ts; }
function toCategoryId(sourceType) {
  const type = String(sourceType || '');
  if (type.startsWith('chat_')) return 'chats';
  if (type.startsWith('proposal_')) return 'proposals';
  if (type.startsWith('task_')) return 'tasks';
  if (type.startsWith('cron_')) return 'cron';
  if (type.startsWith('schedule_')) return 'schedules';
  if (type.startsWith('team_')) return 'teams';
  if (type.startsWith('project_')) return 'projects';
  if (type.startsWith('memory_')) return 'memory';
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
  const modeLabel = state.controls.organizeByType ? 'organized' : 'relation graph';
  const suffix = extra ? ` | ${extra}` : '';
  state.statsEl.textContent = `${getVisibleRecordCount()}/${state.rawNodes.length} nodes | ${state.realEdges.filter((edge) => edge.visible).length} related edges | ${getMatchedNodeCount()} matched | ${modeLabel}${suffix}`;
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
function imageInputEl() { return document.getElementById('memory-image-input'); }
function dropOverlayEl() { return document.getElementById('memory-drop-overlay'); }

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
  renderDetail(null);
}

function resetNodePhysics(node) {
  node.vx = 0;
  node.vy = 0;
  node.x = node.baseX;
  node.y = node.baseY;
  node.sleeping = false;
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
    node.x = node.baseX;
    node.y = node.baseY;
    node.vx = 0;
    node.vy = 0;
    node.sleeping = true;
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
    } else {
      x = ((hashString(`${node.id}:shuffle:x`) % width) - width / 2) * 0.9;
      y = ((hashString(`${node.id}:shuffle:y`) % height) - height / 2) * 0.9;
    }
    node.baseX = x;
    node.baseY = y;
    node.sleeping = false;
  });
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

function buildTypeHubs(nodes) {
  const grouped = new Map();
  nodes.forEach((node) => {
    const categoryId = node.categoryId || 'misc';
    if (!grouped.has(categoryId)) grouped.set(categoryId, []);
    grouped.get(categoryId).push(node);
  });

  const hubs = [];
  const hubEdges = [];
  const entries = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const spreadScale = entries.length > 6 ? 1.14 : 1;
  entries.forEach(([categoryId, items], index) => {
    const meta = CATEGORY_META[categoryId] || CATEGORY_META.misc;
    const angle = (Math.PI * 2 * index) / Math.max(1, entries.length);
    const hub = {
      id: `hub:${categoryId}`,
      label: meta.label,
      sourceType: categoryId,
      sourceTypeLabel: meta.label,
      categoryId,
      color: meta.color,
      radius: clamp(18 + items.length * 0.45, 18, 30),
      degree: items.length,
      summary: `${items.length} records grouped under ${meta.label}.`,
      virtual: true,
      interactive: false,
      isHub: true,
      visible: true,
      matched: true,
      highlighted: false,
      baseX: Math.cos(angle) * 420 * spreadScale,
      baseY: Math.sin(angle) * 260 * spreadScale,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      sleeping: false,
    };
    resetNodePhysics(hub);
    hubs.push(hub);

    items.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    items.forEach((node, itemIndex) => {
      const ring = Math.floor(itemIndex / 14);
      const step = itemIndex % 14;
      const localAngle = (Math.PI * 2 * step) / 14 + (hashString(node.id) % 360) * (Math.PI / 180);
      const spread = 84 + ring * 42 + (hashString(`${node.id}:type`) % 14);
      node.baseX = hub.baseX + Math.cos(localAngle) * spread;
      node.baseY = hub.baseY + Math.sin(localAngle) * (spread * 0.76);
      resetNodePhysics(node);
      hubEdges.push({ id: `hub-edge:${hub.id}:${node.id}`, source: hub.id, target: node.id, weight: 1, type: 'type_group', visible: true, virtual: true });
    });
  });

  return { hubs, hubEdges };
}

function fitGraphToViewport() {
  if (!state.stageEl || !state.renderNodes.length) return;
  const width = state.stageEl.clientWidth || 1;
  const height = state.stageEl.clientHeight || 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  state.renderNodes.forEach((node) => {
    minX = Math.min(minX, node.baseX);
    maxX = Math.max(maxX, node.baseX);
    minY = Math.min(minY, node.baseY);
    maxY = Math.max(maxY, node.baseY);
  });
  const graphWidth = Math.max(1, maxX - minX + 280);
  const graphHeight = Math.max(1, maxY - minY + 280);
  const scale = clamp(Math.min(width / graphWidth, height / graphHeight), 0.18, 1.08);
  state.transform.scale = scale;
  state.transform.x = width / 2 - ((minX + maxX) / 2) * scale;
  state.transform.y = height / 2 - ((minY + maxY) / 2) * scale;
}

function rebuildRenderGraph(relayout = true) {
  const visibleNodes = state.recordNodes.filter((node) => node.visible);
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const filteredEdges = state.realEdges.filter((edge) => edge.visible && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  state.visibleAdjacency = buildAdjacency(filteredEdges);

  if (state.shapeMode === 'image' && state.imagePoints?.length) {
    if (relayout) applyImageShapeToNodes(visibleNodes, state.imagePoints);
    state.renderNodes = [...visibleNodes];
    state.renderEdges = [...filteredEdges];
  } else if (state.shapeMode === 'shuffle') {
    if (relayout) {
      const kinds = ['constellation', 'ring', 'wave', 'spiral', 'diamond', 'flower', 'shell', 'bands'];
      layoutByRandomShape(visibleNodes, kinds[hashString(String(Date.now())) % kinds.length]);
    }
    state.renderNodes = [...visibleNodes];
    state.renderEdges = [...filteredEdges];
  } else if (state.controls.organizeByType) {
    const { hubs, hubEdges } = buildTypeHubs(visibleNodes);
    state.renderNodes = [...hubs, ...visibleNodes];
    state.renderEdges = [...hubEdges];
  } else {
    if (relayout) layoutByComponents(visibleNodes, filteredEdges);
    state.renderNodes = [...visibleNodes];
    state.renderEdges = [...filteredEdges];
  }

  state.nodeById = new Map(state.renderNodes.map((node) => [node.id, node]));
  if (!state.controls.organizeByType) {
    state.renderNodes.forEach((node) => { if (!node.isHub) node.interactive = true; });
  }
  wakeSimulation(relayout ? 1 : 0.55);
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
      color: sourceColor(raw.sourceType),
      categoryId: toCategoryId(raw.sourceType),
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
  return `<strong>${escHtml(node.label)}</strong><div class="meta">${escHtml(node.sourceTypeLabel || node.sourceType || 'Record')} | ${escHtml(formatTime(node.timestamp))}</div><div class="body">${escHtml(node.summary || node.sourcePath || 'No summary available yet.')}</div>`;
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
  const world = uiToWorld(clientX, clientY);
  let best = null;
  let bestDist = Infinity;
  for (const node of state.renderNodes) {
    if (!node.visible) continue;
    const dist = Math.hypot(world.x - node.x, world.y - node.y);
    if (dist <= (node.radius + 7) / state.transform.scale && dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

function draw() {
  if (!state.ctx || !state.canvas || !state.stageEl) return;
  const width = state.stageEl.clientWidth || 1;
  const height = state.stageEl.clientHeight || 1;
  const dpr = window.devicePixelRatio || 1;
  if (state.canvas.width !== Math.round(width * dpr) || state.canvas.height !== Math.round(height * dpr)) {
    state.canvas.width = Math.round(width * dpr);
    state.canvas.height = Math.round(height * dpr);
  }
  state.canvas.style.width = `${width}px`;
  state.canvas.style.height = `${height}px`;
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.ctx.clearRect(0, 0, width, height);

  state.ctx.save();
  state.ctx.translate(state.transform.x, state.transform.y);
  state.ctx.scale(state.transform.scale, state.transform.scale);
  const isOrganized = state.controls.organizeByType;

  for (const edge of state.renderEdges) {
    if (!edge.visible) continue;
    const a = state.nodeById.get(edge.source);
    const b = state.nodeById.get(edge.target);
    if (!a || !b) continue;
    const linkedToHover = state.hoverNodeId && (a.id === state.hoverNodeId || b.id === state.hoverNodeId);
    const linkedToSelected = state.selectedNodeId && (a.id === state.selectedNodeId || b.id === state.selectedNodeId);
    if (isOrganized && state.transform.scale < 0.3 && !linkedToHover && !linkedToSelected) continue;
    const opacity = edge.virtual ? 0.12 : linkedToSelected ? 0.26 : linkedToHover ? 0.18 : 0.08;
    state.ctx.save();
    if (edge.virtual) state.ctx.setLineDash([4, 6]);
    state.ctx.strokeStyle = edge.virtual ? alpha('#ffffff', opacity) : alpha('#91b8ff', opacity);
    state.ctx.lineWidth = edge.virtual ? 1.1 : linkedToSelected ? 1.6 : 1;
    state.ctx.beginPath();
    state.ctx.moveTo(a.x, a.y);
    state.ctx.lineTo(b.x, b.y);
    state.ctx.stroke();
    state.ctx.restore();
  }

  state.renderNodes.forEach((node) => {
    if (!node.visible) return;
    const isSelected = node.id === state.selectedNodeId;
    const isHovered = node.id === state.hoverNodeId;
    const opacity = node.highlighted ? 0.98 : state.controls.search && !node.matched ? 0.24 : 0.84;
    state.ctx.beginPath();
    state.ctx.fillStyle = node.isHub ? alpha(node.color, 0.94) : alpha(node.color, opacity);
    state.ctx.arc(node.x, node.y, node.radius + (isSelected ? 2.4 : isHovered ? 1.2 : 0), 0, Math.PI * 2);
    state.ctx.fill();
    if (isSelected || isHovered || node.isHub) {
      state.ctx.lineWidth = node.isHub ? 2.2 : isSelected ? 2.2 : 1.2;
      state.ctx.strokeStyle = node.isHub ? alpha('#ffffff', 0.92) : isSelected ? '#ffffff' : alpha('#ffffff', 0.76);
      state.ctx.stroke();
    }
  });

  if (state.controls.showLabels) {
    state.ctx.font = '11px Manrope, sans-serif';
    state.ctx.textBaseline = 'middle';
    const maxLabels = isOrganized
      ? Math.round(clamp(18 + state.transform.scale * 44, 18, 52))
      : Math.round(clamp(28 + state.transform.scale * 58, 28, 96));
    const labeled = state.renderNodes
      .filter((node) => node.visible && (node.isHub || node.highlighted || node.id === state.hoverNodeId || node.id === state.selectedNodeId || (state.transform.scale > 0.42 && node.radius >= 6.2)))
      .sort((a, b) => Number(b.isHub) - Number(a.isHub) || b.radius - a.radius)
      .slice(0, maxLabels);
    labeled.forEach((node) => {
      state.ctx.fillStyle = node.id === state.selectedNodeId ? '#ffffff' : alpha('#ecf4ff', 0.86);
      state.ctx.fillText(node.label, node.x + node.radius + 6, node.y);
    });
  }

  state.ctx.restore();
}

function stepSimulation() {
  const visibleNodes = state.renderNodes.filter((node) => node.visible);
  const draggingNode = state.dragState?.type === 'node';
  const organizeMode = state.controls.organizeByType;
  const heat = draggingNode ? 1 : state.simulationHeat;

  if (!draggingNode && heat < 0.018) {
    let changed = false;
    visibleNodes.forEach((node) => {
      if (node.isHub) return;
      const dx = node.baseX - node.x;
      const dy = node.baseY - node.y;
      const speed = Math.abs(node.vx) + Math.abs(node.vy);
      const dist = Math.hypot(dx, dy);
      if (speed < 0.018 && dist < 0.45) {
        node.x = node.baseX;
        node.y = node.baseY;
        node.vx = 0;
        node.vy = 0;
        node.sleeping = true;
        return;
      }
      node.x += dx * 0.22;
      node.y += dy * 0.22;
      node.vx = 0;
      node.vy = 0;
      node.sleeping = false;
      changed = true;
    });
    if (!changed) return;
  }

  const cellSize = 72;
  const buckets = new Map();
  visibleNodes.forEach((node) => {
    const gx = Math.floor(node.x / cellSize);
    const gy = Math.floor(node.y / cellSize);
    const key = `${gx}:${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  });

  visibleNodes.forEach((node) => {
    if (node.isHub) {
      node.vx = 0;
      node.vy = 0;
      node.x = node.baseX;
      node.y = node.baseY;
      return;
    }
    if (draggingNode && node.id === state.dragState.nodeId) {
      node.vx = 0;
      node.vy = 0;
      node.x = state.dragState.worldX;
      node.y = state.dragState.worldY;
      node.sleeping = false;
      return;
    }
    const pull = (node.id === state.selectedNodeId ? 0.0036 : organizeMode ? 0.0043 : 0.0028) * (0.52 + heat * 0.48);
    node.vx += (node.baseX - node.x) * pull;
    node.vy += (node.baseY - node.y) * pull;
  });

  const repulsionBase = Number(state.controls.repulsion || 90) * (organizeMode ? 0.62 : 1) * (0.56 + heat * 0.44);
  const collisionStrength = Number(state.controls.collision || 24) / 100;
  visibleNodes.forEach((node) => {
    if (node.sleeping && !draggingNode) return;
    const gx = Math.floor(node.x / cellSize);
    const gy = Math.floor(node.y / cellSize);
    for (let ix = -1; ix <= 1; ix += 1) {
      for (let iy = -1; iy <= 1; iy += 1) {
        const list = buckets.get(`${gx + ix}:${gy + iy}`);
        if (!list) continue;
        list.forEach((other) => {
          if (other.id === node.id || other.id < node.id) return;
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);
          if (dist > (organizeMode ? 92 : 110)) return;
          const repulsion = repulsionBase / distSq;
          const fx = (dx / dist) * repulsion;
          const fy = (dy / dist) * repulsion;
          if (!node.isHub) { node.vx -= fx; node.vy -= fy; }
          if (!other.isHub) { other.vx += fx; other.vy += fy; }

          const minDist = node.radius + other.radius + collisionStrength * (organizeMode ? 18 : 22);
          if (dist < minDist) {
            const overlap = (minDist - dist) * (organizeMode ? 0.009 : 0.012);
            const ox = (dx / dist) * overlap;
            const oy = (dy / dist) * overlap;
            if (!node.isHub) { node.vx -= ox; node.vy -= oy; }
            if (!other.isHub) { other.vx += ox; other.vy += oy; }
          }
        });
      }
    }
  });

  const linkStrength = Number(state.controls.linkStrength || 0.026) * (organizeMode ? 0.66 : 1) * (0.48 + heat * 0.52);
  state.renderEdges.forEach((edge) => {
    if (!edge.visible) return;
    const source = state.nodeById.get(edge.source);
    const target = state.nodeById.get(edge.target);
    if (!source || !target) return;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy) || 1;
    const targetDist = edge.virtual ? 78 : 38 + (1 - Number(edge.weight || 0)) * 34;
    const force = (dist - targetDist) * (edge.virtual ? linkStrength * 0.8 : linkStrength);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!source.isHub) { source.vx += fx; source.vy += fy; }
    if (!target.isHub) { target.vx -= fx; target.vy -= fy; }
  });

  if (draggingNode) {
    const followers = state.dragState.followers || new Map();
    followers.forEach((offset, nodeId) => {
      if (nodeId === state.dragState.nodeId) return;
      const node = state.recordNodeById.get(nodeId);
      if (!node || !node.visible) return;
      const desiredX = state.dragState.worldX + offset.x;
      const desiredY = state.dragState.worldY + offset.y;
      node.vx += (desiredX - node.x) * 0.04;
      node.vy += (desiredY - node.y) * 0.04;
      node.sleeping = false;
    });

    visibleNodes.forEach((node) => {
      if (node.isHub || followers.has(node.id)) return;
      const dx = state.dragState.worldX - node.x;
      const dy = state.dragState.worldY - node.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > 210) return;
      const influence = (1 - dist / 210) * 0.34;
      node.vx -= (dx / dist) * influence;
      node.vy -= (dy / dist) * influence;
      node.sleeping = false;
    });
  }

  visibleNodes.forEach((node) => {
    if (node.isHub || (draggingNode && node.id === state.dragState.nodeId)) return;
    node.vx *= organizeMode ? 0.8 : 0.88;
    node.vy *= organizeMode ? 0.8 : 0.88;
    node.vx = clamp(node.vx, organizeMode ? -4.8 : -6, organizeMode ? 4.8 : 6);
    node.vy = clamp(node.vy, organizeMode ? -4.8 : -6, organizeMode ? 4.8 : 6);
    node.x += node.vx;
    node.y += node.vy;
    const speed = Math.abs(node.vx) + Math.abs(node.vy);
    const distToBase = Math.hypot(node.baseX - node.x, node.baseY - node.y);
    if (speed < 0.035 && distToBase < 0.9) {
      node.x = node.baseX;
      node.y = node.baseY;
      node.vx = 0;
      node.vy = 0;
      node.sleeping = true;
    } else if (!draggingNode && heat < 0.08 && speed < 0.08 && distToBase < (organizeMode ? 3.4 : 2.4)) {
      node.x += (node.baseX - node.x) * 0.36;
      node.y += (node.baseY - node.y) * 0.36;
      node.vx *= 0.28;
      node.vy *= 0.28;
      if (Math.hypot(node.baseX - node.x, node.baseY - node.y) < 0.45) {
        node.x = node.baseX;
        node.y = node.baseY;
        node.vx = 0;
        node.vy = 0;
        node.sleeping = true;
      }
    } else {
      node.sleeping = false;
    }
  });

  if (!draggingNode) {
    state.simulationHeat *= organizeMode ? 0.94 : 0.968;
    if (state.simulationHeat < 0.0008) state.simulationHeat = 0;
  } else {
    state.simulationHeat = 1;
  }
}

function animate() { stepSimulation(); draw(); state.raf = requestAnimationFrame(animate); }

async function loadDetail(recordId) {
  if (!recordId) return;
  if (state.detailCache.has(recordId)) return renderDetail(state.detailCache.get(recordId));
  state.detailEl.innerHTML = '<div class="memory-detail-empty">Loading record details...</div>';
  try {
    const data = await api(ENDPOINTS.memoryRecord(recordId));
    state.detailCache.set(recordId, data);
    renderDetail(data);
  } catch (err) {
    state.detailEl.innerHTML = `<div class="memory-detail-empty">${escHtml(err.message || 'Failed to load record detail')}</div>`;
  }
}

function renderDetail(payload) {
  if (!state.detailEl) return;
  const record = payload?.record;
  if (!record) {
    state.detailEl.innerHTML = '<div class="memory-detail-empty">Select a record node to inspect its summary, source, and related records.</div>';
    return;
  }
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks.slice(0, 2) : [];
  const related = Array.isArray(payload?.related) ? payload.related.slice(0, 6) : [];
  state.detailEl.innerHTML = `
    <div class="memory-detail-heading"><div><h3>${escHtml(record.title || 'Untitled record')}</h3></div><div class="memory-detail-chip">${escHtml(record.sourceType || 'record')}</div></div>
    <div class="memory-detail-meta">
      <div><strong>Time</strong>${escHtml(formatTime(record.timestamp || ''))}</div>
      <div><strong>Project</strong>${escHtml(record.projectId || 'None')}</div>
      <div><strong>Durability</strong>${escHtml(String(Number(record.durability || 0).toFixed(2)))}</div>
      <div><strong>Source</strong>${escHtml(record.sourcePath || '')}</div>
    </div>
    <div class="memory-detail-section-title">Summary</div>
    <div class="memory-detail-summary">${escHtml(chunks[0]?.text || 'No indexed summary available for this record yet.')}</div>
    <div class="memory-detail-section-title">Preview</div>
    <div class="memory-detail-chunk">${escHtml(record.sourcePath || 'No source path available.')}</div>
    <div class="memory-detail-section-title">Indexed Chunks</div>
    ${chunks.map((chunk) => `<div class="memory-detail-chunk">${escHtml(String(chunk.text || '').slice(0, 420))}</div>`).join('') || '<div class="memory-detail-empty">No indexed chunks available.</div>'}
    <div class="memory-detail-section-title">Related Records</div>
    <div class="memory-related-list">
      ${related.map((item) => `<button type="button" class="memory-related-item" data-record-id="${escHtml(item.recordId)}"><strong>${escHtml(item.title || item.recordId)}</strong><div class="meta">${escHtml(item.sourceType || 'record')} | ${escHtml(formatTime(item.timestamp || ''))}</div><div class="body">${escHtml(item.preview || '')}</div></button>`).join('') || '<div class="memory-detail-empty">No related records returned for this node.</div>'}
    </div>
  `;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = state.recordNodeById.get(nodeId);
  if (!node) return renderDetail(null);
  openMemoryDetailDrawer();
  setControlsCollapsed(true);
  loadDetail(nodeId);
}

async function fetchGraph(options = {}) {
  if (options.refreshIndex === true) {
    updateStatsText('refreshing index');
    await api(ENDPOINTS.MEMORY_REFRESH, { method: 'POST', body: '{}' }).catch(() => null);
  }
  const data = await api(ENDPOINTS.MEMORY_GRAPH);
  processGraph(data);
  state.graphLoadedAt = Date.now();
  if (state.emptyEl) state.emptyEl.style.display = state.recordNodes.length ? 'none' : 'flex';
  updateStatsText();
  draw();
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
      }, 220);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function handlePointerMove(event) {
  if (!state.canvas) return;
  if (state.dragState?.type === 'pan') {
    state.transform.x = state.dragState.originX + (event.clientX - state.dragState.startClientX);
    state.transform.y = state.dragState.originY + (event.clientY - state.dragState.startClientY);
    hideTooltip();
    return;
  }
  if (state.dragState?.type === 'node') {
    const world = uiToWorld(event.clientX, event.clientY);
    state.dragState.worldX = world.x - state.dragState.offsetX;
    state.dragState.worldY = world.y - state.dragState.offsetY;
    wakeSimulation(1);
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
  const node = getNodeAtPoint(event.clientX, event.clientY);
  if (node && node.interactive !== false) {
    const world = uiToWorld(event.clientX, event.clientY);
    const connected = getFollowers(node.id, 2);
    const followers = new Map();
    connected.forEach((id) => {
      const follower = state.recordNodeById.get(id);
      if (!follower) return;
      followers.set(id, { x: follower.x - node.x, y: follower.y - node.y });
    });
    state.dragState = { type: 'node', nodeId: node.id, worldX: node.x, worldY: node.y, offsetX: world.x - node.x, offsetY: world.y - node.y, followers };
    state.canvas.classList.add('is-dragging');
    selectNode(node.id);
    return;
  }
  state.dragState = { type: 'pan', startClientX: event.clientX, startClientY: event.clientY, originX: state.transform.x, originY: state.transform.y };
  state.canvas.classList.add('is-dragging');
}

function handlePointerUp() {
  if (state.dragState?.type === 'node') {
    const anchor = state.recordNodeById.get(state.dragState.nodeId);
    if (anchor) {
      anchor.baseX = state.dragState.worldX;
      anchor.baseY = state.dragState.worldY;
      anchor.sleeping = false;
    }
    const followers = state.dragState.followers || new Map();
    followers.forEach((offset, nodeId) => {
      const node = state.recordNodeById.get(nodeId);
      if (!node) return;
      node.baseX = state.dragState.worldX + offset.x;
      node.baseY = state.dragState.worldY + offset.y;
      node.sleeping = false;
    });
    resolveClusterOverlap(followers.keys());
    if (anchor) {
      anchor.x = anchor.baseX;
      anchor.y = anchor.baseY;
      anchor.vx = 0;
      anchor.vy = 0;
      anchor.sleeping = true;
    }
    state.simulationHeat = 0.02;
  }
  state.dragState = null;
  if (state.canvas) state.canvas.classList.remove('is-dragging');
}

function handleWheel(event) {
  if (!state.canvas) return;
  event.preventDefault();
  const before = uiToWorld(event.clientX, event.clientY);
  const nextScale = clamp(state.transform.scale * (event.deltaY > 0 ? 0.92 : 1.08), 0.14, 2.8);
  state.transform.scale = nextScale;
  state.transform.x = event.clientX - state.canvas.getBoundingClientRect().left - before.x * nextScale;
  state.transform.y = event.clientY - state.canvas.getBoundingClientRect().top - before.y * nextScale;
  hideTooltip();
}

function toggleMemoryControlsPanel() {
  setControlsCollapsed(!state.controlsCollapsed);
}

function triggerMemoryImageInput() {
  imageInputEl()?.click();
}

function shuffleMemoryGraph() {
  explodeNodes(5.8);
  clearTimeout(state.shuffleTimer);
  state.shuffleTimer = setTimeout(() => {
    commitLayoutMode('shuffle', true);
    showToast('Nodes shuffled', 'The graph exploded outward and settled into a new shape.', 'success', 2200);
  }, 220);
}

function bindControls() {
  const searchInput = document.getElementById('memory-search-input');
  const typeFilter = document.getElementById('memory-type-filter');
  const edgeWeight = document.getElementById('memory-edge-weight');
  const edgeWeightValue = document.getElementById('memory-edge-weight-value');
  const showLabels = document.getElementById('memory-show-labels');
  const organizeByType = document.getElementById('memory-organize-type');
  const repulsion = document.getElementById('memory-force-repulsion');
  const link = document.getElementById('memory-force-link');
  const collision = document.getElementById('memory-force-collision');
  const imageInput = imageInputEl();

  if (edgeWeightValue) edgeWeightValue.textContent = `${state.controls.minEdgeWeight.toFixed(2)}+`;
  searchInput?.addEventListener('input', () => { state.controls.search = searchInput.value || ''; applyFilters({ relayout: false }); });
  typeFilter?.addEventListener('change', () => { state.controls.typeFilter = typeFilter.value || ''; if (state.shapeMode !== 'image') state.shapeMode = 'default'; applyFilters({ relayout: true }); });
  edgeWeight?.addEventListener('input', () => { state.controls.minEdgeWeight = Number(edgeWeight.value || 0) / 100; if (edgeWeightValue) edgeWeightValue.textContent = `${state.controls.minEdgeWeight.toFixed(2)}+`; if (state.shapeMode !== 'image') state.shapeMode = 'default'; applyFilters({ relayout: true }); });
  showLabels?.addEventListener('change', () => { state.controls.showLabels = !!showLabels.checked; });
  organizeByType?.addEventListener('change', () => { state.controls.organizeByType = !!organizeByType.checked; if (state.controls.organizeByType) state.shapeMode = 'default'; applyFilters({ relayout: true }); });
  repulsion?.addEventListener('input', () => { state.controls.repulsion = Number(repulsion.value || 90); });
  link?.addEventListener('input', () => { state.controls.linkStrength = Number(link.value || 26) / 1000; });
  collision?.addEventListener('input', () => { state.controls.collision = Number(collision.value || 24); });
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    state.controls.organizeByType = false;
    const organizeToggle = document.getElementById('memory-organize-type');
    if (organizeToggle) organizeToggle.checked = false;
    loadImageShapeFromFile(file);
    imageInput.value = '';
  });

  state.detailEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-record-id]');
    if (!button) return;
    const recordId = button.getAttribute('data-record-id');
    if (!recordId) return;
    selectNode(recordId);
    const node = state.recordNodeById.get(recordId);
    if (node) {
      const width = state.stageEl.clientWidth || 1;
      const height = state.stageEl.clientHeight || 1;
      state.transform.x = width / 2 - node.x * state.transform.scale;
      state.transform.y = height / 2 - node.y * state.transform.scale;
    }
  });
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
    const organizeToggle = document.getElementById('memory-organize-type');
    if (organizeToggle) organizeToggle.checked = false;
    loadImageShapeFromFile(file);
  });
  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(() => { draw(); });
    state.resizeObserver.observe(state.stageEl);
  } else {
    window.addEventListener('resize', draw);
  }
}

function init() {
  if (state.initialized) return;
  state.initialized = true;
  setupCanvas();
  bindControls();
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

export function memoryPageActivate() {
  init();
  if (state.graphLoadedAt === 0 || (Date.now() - state.graphLoadedAt) > 45000) fetchGraph().catch(() => {});
  draw();
}

window.refreshMemoryGraph = refreshMemoryGraph;
window.memoryPageActivate = memoryPageActivate;
window.toggleMemoryControlsPanel = toggleMemoryControlsPanel;
window.closeMemoryDetailDrawer = closeMemoryDetailDrawer;
window.shuffleMemoryGraph = shuffleMemoryGraph;
window.triggerMemoryImageInput = triggerMemoryImageInput;

init();


