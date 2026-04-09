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
    minEdgeWeight: 0.12,
    showLabels: true,
    repulsion: 90,
    linkStrength: 0.026,
    collision: 24,
  },
  transform: { x: 0, y: 0, scale: 1 },
  rawNodes: [],
  rawEdges: [],
  nodes: [],
  edges: [],
  nodeById: new Map(),
  adjacency: new Map(),
  hoverNodeId: null,
  selectedNodeId: null,
  hoverPoint: null,
  detailCache: new Map(),
  dragState: null,
  raf: 0,
  resizeObserver: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  return Math.abs(hash);
}

function sourceColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.unknown;
}

function alpha(color, opacity) {
  const hex = String(color || '#ffffff').replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex.padEnd(6, 'f');
  const int = parseInt(expanded.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function formatTime(ts) {
  if (!ts) return 'Unknown';
  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) return ts;
  return new Date(parsed).toLocaleString();
}

function uiToWorld(clientX, clientY) {
  const rect = state.canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return {
    x: (localX - state.transform.x) / state.transform.scale,
    y: (localY - state.transform.y) / state.transform.scale,
  };
}

function worldToUi(x, y) {
  return {
    x: x * state.transform.scale + state.transform.x,
    y: y * state.transform.scale + state.transform.y,
  };
}

function getVisibleNodeCount() {
  return state.nodes.reduce((sum, node) => sum + (node.visible ? 1 : 0), 0);
}

function getMatchedNodeCount() {
  return state.nodes.reduce((sum, node) => sum + (node.matched ? 1 : 0), 0);
}

function updateStatsText(extra = '') {
  if (!state.statsEl) return;
  const visible = getVisibleNodeCount();
  const matched = getMatchedNodeCount();
  const total = state.rawNodes.length;
  const edgeCount = state.edges.filter((edge) => edge.visible).length;
  const suffix = extra ? ` • ${extra}` : '';
  state.statsEl.textContent = `${visible}/${total} nodes • ${edgeCount} edges • ${matched} matched${suffix}`;
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
      const neighbors = state.adjacency.get(id) || new Set();
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

function computeBaseLayout(nodes) {
  const groups = new Map();
  nodes.forEach((node) => {
    const key = node.sourceType || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  });

  const entries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const radiusX = 520;
  const radiusY = 280;
  entries.forEach(([group, groupNodes], groupIndex) => {
    const angle = (Math.PI * 2 * groupIndex) / Math.max(1, entries.length);
    const centerX = Math.cos(angle) * radiusX;
    const centerY = Math.sin(angle) * radiusY * 0.78;
    groupNodes.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    groupNodes.forEach((node, index) => {
      const ring = Math.floor(index / 18);
      const step = index % 18;
      const localAngle = (Math.PI * 2 * step) / 18 + (hashString(group) % 360) * (Math.PI / 180);
      const spread = 48 + ring * 38 + (hashString(node.id) % 11);
      node.baseX = centerX + Math.cos(localAngle) * spread;
      node.baseY = centerY + Math.sin(localAngle) * (spread * 0.72);
      node.x = node.baseX + ((hashString(`${node.id}:x`) % 50) - 25);
      node.y = node.baseY + ((hashString(`${node.id}:y`) % 50) - 25);
      node.vx = 0;
      node.vy = 0;
    });
  });
}

function fitGraphToViewport() {
  if (!state.stageEl || !state.nodes.length) return;
  const width = state.stageEl.clientWidth || 1;
  const height = state.stageEl.clientHeight || 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  state.nodes.forEach((node) => {
    minX = Math.min(minX, node.baseX);
    maxX = Math.max(maxX, node.baseX);
    minY = Math.min(minY, node.baseY);
    maxY = Math.max(maxY, node.baseY);
  });
  const graphWidth = Math.max(1, maxX - minX + 220);
  const graphHeight = Math.max(1, maxY - minY + 220);
  const scale = clamp(Math.min(width / graphWidth, height / graphHeight), 0.22, 1.1);
  state.transform.scale = scale;
  state.transform.x = width / 2 - ((minX + maxX) / 2) * scale;
  state.transform.y = height / 2 - ((minY + maxY) / 2) * scale;
}

function processGraph(data) {
  state.rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  state.rawEdges = Array.isArray(data.edges) ? data.edges : [];
  state.nodeById = new Map();
  state.nodes = state.rawNodes.map((raw) => {
    const degree = Number(raw.degree || 0);
    const radius = clamp(3 + Math.sqrt(Math.max(0, degree)) * 0.72 + Number(raw.durability || 0.5) * 2.6, 3, 13);
    const node = {
      ...raw,
      degree,
      radius,
      color: sourceColor(raw.sourceType),
      visible: true,
      matched: true,
      highlighted: false,
      baseX: 0,
      baseY: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
    state.nodeById.set(node.id, node);
    return node;
  });

  state.edges = state.rawEdges
    .filter((edge) => state.nodeById.has(edge.source) && state.nodeById.has(edge.target))
    .map((edge) => ({
      ...edge,
      visible: true,
    }));
  state.adjacency = buildAdjacency(state.edges);
  computeBaseLayout(state.nodes);
  applyFilters();
  fitGraphToViewport();
}

function applyFilters() {
  const query = String(state.controls.search || '').trim().toLowerCase();
  const typeFilter = String(state.controls.typeFilter || '').trim();
  const minWeight = Number(state.controls.minEdgeWeight || 0);
  const queryTerms = query.split(/\s+/).filter(Boolean);

  state.nodes.forEach((node) => {
    const haystack = `${node.label} ${node.sourcePath} ${node.summary || ''} ${node.sourceTypeLabel || ''}`.toLowerCase();
    const queryMatch = !queryTerms.length || queryTerms.every((term) => haystack.includes(term));
    const typeMatch = !typeFilter || node.sourceType === typeFilter;
    node.matched = queryMatch;
    node.visible = typeMatch;
    node.highlighted = queryTerms.length > 0 && queryMatch;
  });

  state.edges.forEach((edge) => {
    const source = state.nodeById.get(edge.source);
    const target = state.nodeById.get(edge.target);
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

  if (state.hoverNodeId && !state.nodeById.get(state.hoverNodeId)?.visible) hideTooltip();
  updateStatsText(queryTerms.length ? 'search active' : '');
}

function hideTooltip() {
  state.hoverNodeId = null;
  state.hoverPoint = null;
  if (state.tooltipEl) state.tooltipEl.style.display = 'none';
}

function showTooltip(node, point) {
  if (!state.tooltipEl || !state.stageEl || !node) return;
  state.hoverNodeId = node.id;
  state.hoverPoint = point;
  state.tooltipEl.innerHTML = `
    <strong>${escHtml(node.label)}</strong>
    <div class="meta">${escHtml(node.sourceTypeLabel || node.sourceType || 'Record')} • ${escHtml(formatTime(node.timestamp))}</div>
    <div class="body">${escHtml(node.summary || node.sourcePath || 'No summary available yet.')}</div>
  `;
  const stageRect = state.stageEl.getBoundingClientRect();
  const x = clamp(point.x + 18, 12, stageRect.width - 292);
  const y = clamp(point.y + 18, 12, stageRect.height - 150);
  state.tooltipEl.style.left = `${x}px`;
  state.tooltipEl.style.top = `${y}px`;
  state.tooltipEl.style.display = 'block';
}

function getNodeAtPoint(clientX, clientY) {
  const world = uiToWorld(clientX, clientY);
  let best = null;
  let bestDist = Infinity;
  for (const node of state.nodes) {
    if (!node.visible) continue;
    const dx = world.x - node.x;
    const dy = world.y - node.y;
    const dist = Math.hypot(dx, dy);
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

  for (const edge of state.edges) {
    if (!edge.visible) continue;
    const a = state.nodeById.get(edge.source);
    const b = state.nodeById.get(edge.target);
    if (!a || !b) continue;
    const linkedToHover = state.hoverNodeId && (a.id === state.hoverNodeId || b.id === state.hoverNodeId);
    const linkedToSelected = state.selectedNodeId && (a.id === state.selectedNodeId || b.id === state.selectedNodeId);
    const opacity = linkedToSelected ? 0.24 : linkedToHover ? 0.18 : 0.08;
    state.ctx.strokeStyle = alpha(linkedToSelected ? '#ffffff' : '#91b8ff', opacity);
    state.ctx.lineWidth = linkedToSelected ? 1.6 : 1;
    state.ctx.beginPath();
    state.ctx.moveTo(a.x, a.y);
    state.ctx.lineTo(b.x, b.y);
    state.ctx.stroke();
  }

  state.nodes.forEach((node) => {
    if (!node.visible) return;
    const isSelected = node.id === state.selectedNodeId;
    const isHovered = node.id === state.hoverNodeId;
    const opacity = node.highlighted ? 0.96 : state.controls.search && !node.matched ? 0.24 : 0.82;
    state.ctx.beginPath();
    state.ctx.fillStyle = alpha(node.color, opacity);
    state.ctx.arc(node.x, node.y, node.radius + (isSelected ? 2.3 : isHovered ? 1.2 : 0), 0, Math.PI * 2);
    state.ctx.fill();
    if (isSelected || isHovered) {
      state.ctx.lineWidth = isSelected ? 2.2 : 1.2;
      state.ctx.strokeStyle = isSelected ? '#ffffff' : alpha('#ffffff', 0.76);
      state.ctx.stroke();
    }
  });

  if (state.controls.showLabels) {
    state.ctx.font = '11px Manrope, sans-serif';
    state.ctx.textBaseline = 'middle';
    const highlighted = state.nodes
      .filter((node) => node.visible && (node.highlighted || node.id === state.hoverNodeId || node.id === state.selectedNodeId || node.radius >= 6.2))
      .sort((a, b) => b.radius - a.radius)
      .slice(0, 80);
    highlighted.forEach((node) => {
      state.ctx.fillStyle = node.id === state.selectedNodeId ? '#ffffff' : alpha('#ecf4ff', 0.84);
      state.ctx.fillText(node.label, node.x + node.radius + 6, node.y);
    });
  }

  state.ctx.restore();
}

function stepSimulation() {
  const visibleNodes = state.nodes.filter((node) => node.visible);
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
    if (state.dragState?.type === 'node' && node.id === state.dragState.nodeId) {
      node.vx = 0;
      node.vy = 0;
      node.x = state.dragState.worldX;
      node.y = state.dragState.worldY;
      return;
    }
    const pull = node.id === state.selectedNodeId ? 0.0032 : 0.0024;
    node.vx += (node.baseX - node.x) * pull;
    node.vy += (node.baseY - node.y) * pull;
  });

  const repulsionBase = Number(state.controls.repulsion || 90);
  const collisionStrength = Number(state.controls.collision || 24) / 100;
  visibleNodes.forEach((node) => {
    const gx = Math.floor(node.x / cellSize);
    const gy = Math.floor(node.y / cellSize);
    for (let ix = -1; ix <= 1; ix += 1) {
      for (let iy = -1; iy <= 1; iy += 1) {
        const list = buckets.get(`${gx + ix}:${gy + iy}`);
        if (!list) continue;
        list.forEach((other) => {
          if (other.id === node.id) return;
          if (other.id < node.id) return;
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);
          if (dist > 110) return;
          const repulsion = repulsionBase / distSq;
          const fx = (dx / dist) * repulsion;
          const fy = (dy / dist) * repulsion;
          node.vx -= fx;
          node.vy -= fy;
          other.vx += fx;
          other.vy += fy;

          const minDist = node.radius + other.radius + collisionStrength * 22;
          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.018;
            const ox = (dx / dist) * overlap;
            const oy = (dy / dist) * overlap;
            node.vx -= ox;
            node.vy -= oy;
            other.vx += ox;
            other.vy += oy;
          }
        });
      }
    }
  });

  const linkStrength = Number(state.controls.linkStrength || 0.026);
  state.edges.forEach((edge) => {
    if (!edge.visible) return;
    const source = state.nodeById.get(edge.source);
    const target = state.nodeById.get(edge.target);
    if (!source || !target) return;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy) || 1;
    const targetDist = 34 + (1 - Number(edge.weight || 0)) * 40;
    const stretch = dist - targetDist;
    const force = stretch * linkStrength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  });

  if (state.dragState?.type === 'node') {
    const followers = state.dragState.followers || new Map();
    followers.forEach((offset, nodeId) => {
      if (nodeId === state.dragState.nodeId) return;
      const node = state.nodeById.get(nodeId);
      if (!node || !node.visible) return;
      const desiredX = state.dragState.worldX + offset.x;
      const desiredY = state.dragState.worldY + offset.y;
      node.vx += (desiredX - node.x) * 0.035;
      node.vy += (desiredY - node.y) * 0.035;
    });

    const influenceX = state.dragState.worldX;
    const influenceY = state.dragState.worldY;
    visibleNodes.forEach((node) => {
      if (followers.has(node.id)) return;
      const dx = influenceX - node.x;
      const dy = influenceY - node.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > 220) return;
      const influence = (1 - dist / 220) * 0.35;
      node.vx -= (dx / dist) * influence;
      node.vy -= (dy / dist) * influence;
    });
  }

  visibleNodes.forEach((node) => {
    if (state.dragState?.type === 'node' && node.id === state.dragState.nodeId) return;
    node.vx *= 0.92;
    node.vy *= 0.92;
    node.vx = clamp(node.vx, -6, 6);
    node.vy = clamp(node.vy, -6, 6);
    node.x += node.vx;
    node.y += node.vy;
  });
}

function animate() {
  stepSimulation();
  draw();
  state.raf = requestAnimationFrame(animate);
}

async function loadDetail(recordId) {
  if (!recordId) return;
  if (state.detailCache.has(recordId)) {
    renderDetail(state.detailCache.get(recordId));
    return;
  }
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
    state.detailEl.innerHTML = '<div class="memory-detail-empty">No detail available for this node.</div>';
    return;
  }
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks.slice(0, 2) : [];
  const related = Array.isArray(payload?.related) ? payload.related.slice(0, 6) : [];
  state.detailEl.innerHTML = `
    <div class="memory-detail-heading">
      <div>
        <h3>${escHtml(record.title || 'Untitled record')}</h3>
      </div>
      <div class="memory-detail-chip">${escHtml(record.sourceType || 'record')}</div>
    </div>
    <div class="memory-detail-meta">
      <div><strong>Time</strong>${escHtml(formatTime(record.timestamp || ''))}</div>
      <div><strong>Project</strong>${escHtml(record.projectId || 'None')}</div>
      <div><strong>Durability</strong>${escHtml(String(Number(record.durability || 0).toFixed(2)))}</div>
      <div><strong>Source</strong>${escHtml(record.sourcePath || '')}</div>
    </div>
    <div class="memory-detail-section-title">Summary</div>
    <div class="memory-detail-summary">${escHtml(chunks[0]?.text || 'No indexed summary available for this record yet.')}</div>
    <div class="memory-detail-section-title">Indexed Chunks</div>
    ${chunks.map((chunk) => `<div class="memory-detail-chunk">${escHtml(String(chunk.text || '').slice(0, 420))}</div>`).join('') || '<div class="memory-detail-empty">No indexed chunks available.</div>'}
    <div class="memory-detail-section-title">Related Records</div>
    <div class="memory-related-list">
      ${related.map((item) => `
        <button type="button" class="memory-related-item" data-record-id="${escHtml(item.recordId)}">
          <strong>${escHtml(item.title || item.recordId)}</strong>
          <div class="meta">${escHtml(item.sourceType || 'record')} • ${escHtml(formatTime(item.timestamp || ''))}</div>
          <div class="body">${escHtml(item.preview || '')}</div>
        </button>
      `).join('') || '<div class="memory-detail-empty">No related records returned for this node.</div>'}
    </div>
  `;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  if (!nodeId) {
    renderDetail(null);
    return;
  }
  loadDetail(nodeId);
}

async function fetchGraph(options = {}) {
  const refreshIndex = options.refreshIndex === true;
  if (refreshIndex) {
    updateStatsText('refreshing index');
    await api(ENDPOINTS.MEMORY_REFRESH, { method: 'POST', body: '{}' }).catch(() => null);
  }
  const data = await api(ENDPOINTS.MEMORY_GRAPH);
  processGraph(data);
  state.graphLoadedAt = Date.now();
  if (state.emptyEl) state.emptyEl.style.display = state.nodes.length ? 'none' : 'flex';
  updateStatsText();
  draw();
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
    hideTooltip();
    return;
  }
  const node = getNodeAtPoint(event.clientX, event.clientY);
  if (!node) {
    hideTooltip();
    return;
  }
  const rect = state.canvas.getBoundingClientRect();
  showTooltip(node, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function handlePointerDown(event) {
  if (!state.canvas) return;
  const node = getNodeAtPoint(event.clientX, event.clientY);
  if (node) {
    const world = uiToWorld(event.clientX, event.clientY);
    const connected = getFollowers(node.id, 2);
    const followers = new Map();
    connected.forEach((id) => {
      const follower = state.nodeById.get(id);
      if (!follower) return;
      followers.set(id, {
        x: follower.x - node.x,
        y: follower.y - node.y,
      });
    });
    state.dragState = {
      type: 'node',
      nodeId: node.id,
      worldX: node.x,
      worldY: node.y,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y,
      followers,
    };
    state.canvas.classList.add('is-dragging');
    selectNode(node.id);
    return;
  }
  state.dragState = {
    type: 'pan',
    startClientX: event.clientX,
    startClientY: event.clientY,
    originX: state.transform.x,
    originY: state.transform.y,
  };
  state.canvas.classList.add('is-dragging');
}

function handlePointerUp() {
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

function bindControls() {
  const searchInput = document.getElementById('memory-search-input');
  const typeFilter = document.getElementById('memory-type-filter');
  const edgeWeight = document.getElementById('memory-edge-weight');
  const edgeWeightValue = document.getElementById('memory-edge-weight-value');
  const showLabels = document.getElementById('memory-show-labels');
  const repulsion = document.getElementById('memory-force-repulsion');
  const link = document.getElementById('memory-force-link');
  const collision = document.getElementById('memory-force-collision');

  searchInput?.addEventListener('input', () => {
    state.controls.search = searchInput.value || '';
    applyFilters();
  });
  typeFilter?.addEventListener('change', () => {
    state.controls.typeFilter = typeFilter.value || '';
    applyFilters();
  });
  edgeWeight?.addEventListener('input', () => {
    state.controls.minEdgeWeight = Number(edgeWeight.value || 0) / 100;
    if (edgeWeightValue) edgeWeightValue.textContent = `${state.controls.minEdgeWeight.toFixed(2)}+`;
    applyFilters();
  });
  showLabels?.addEventListener('change', () => {
    state.controls.showLabels = !!showLabels.checked;
  });
  repulsion?.addEventListener('input', () => {
    state.controls.repulsion = Number(repulsion.value || 90);
  });
  link?.addEventListener('input', () => {
    state.controls.linkStrength = Number(link.value || 26) / 1000;
  });
  collision?.addEventListener('input', () => {
    state.controls.collision = Number(collision.value || 24);
  });

  state.detailEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-record-id]');
    if (!button) return;
    const recordId = button.getAttribute('data-record-id');
    if (!recordId) return;
    selectNode(recordId);
    const node = state.nodeById.get(recordId);
    if (node) {
      state.selectedNodeId = recordId;
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

  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(() => {
      draw();
    });
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
  if (state.graphLoadedAt === 0 || (Date.now() - state.graphLoadedAt) > 45000) {
    fetchGraph().catch(() => {});
  }
  draw();
}

window.refreshMemoryGraph = refreshMemoryGraph;
window.memoryPageActivate = memoryPageActivate;

init();
