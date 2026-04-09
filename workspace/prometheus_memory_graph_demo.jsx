import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WIDTH = 980;
const HEIGHT = 620;
const SPRING_LENGTH = 34;
const REPULSION = 4200;
const SPRING_STRENGTH = 0.012;
const DAMPING = 0.92;
const INFLUENCE_RADIUS = 130;
const MAX_SPEED = 7;

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildNeighborLinks(createdNodes, countMin = 3, countMax = 5) {
  const createdLinks = [];

  createdNodes.forEach((node, i) => {
    const distances = createdNodes
      .filter((_, idx) => idx !== i)
      .map((other) => ({
        id: other.id,
        d: Math.hypot(node.x - other.x, node.y - other.y),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, countMin + Math.floor(Math.random() * (countMax - countMin + 1)));

    distances.forEach((entry) => {
      if (!createdLinks.find((l) => (l.a === node.id && l.b === entry.id) || (l.a === entry.id && l.b === node.id))) {
        createdLinks.push({ a: node.id, b: entry.id });
      }
    });
  });

  return createdLinks;
}

function createSimNodes(sourceNodes) {
  return sourceNodes.map((node) => ({
    ...node,
    baseX: node.x,
    baseY: node.y,
    vx: 0,
    vy: 0,
    fixed: false,
    grabbed: false,
  }));
}

function getConnectedSet(startId, links) {
  const seen = new Set([startId]);
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift();
    links.forEach((link) => {
      const neighbor = link.a === current ? link.b : link.b === current ? link.a : null;
      if (neighbor && !seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    });
  }

  return seen;
}

export default function PrometheusMemoryGraphDemo() {
  const [imageData, setImageData] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [labels, setLabels] = useState([]);
  const [status, setStatus] = useState("Upload an image to turn the graph into a silhouette.");
  const [density, setDensity] = useState(750);
  const [threshold, setThreshold] = useState(180);
  const [showHull, setShowHull] = useState(true);
  const [pulse, setPulse] = useState(true);
  const [simNodes, setSimNodes] = useState([]);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragState, setDragState] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const svgRef = useRef(null);
  const viewportRef = useRef(transform);
  const dragStateRef = useRef(null);
  const simNodesRef = useRef([]);
  const animationRef = useRef(null);

  const defaultKeywords = useMemo(
    () => [
      "Prometheus",
      "Memory",
      "Claude",
      "OpenClaw",
      "Sessions",
      "Notes",
      "Tasks",
      "Embeddings",
      "Search",
      "Agents",
      "Qwen",
      "Architecture",
      "OAuth",
      "Daily Logs",
      "Plans",
      "RAG",
      "Entities",
      "Knowledge",
    ],
    []
  );

  useEffect(() => {
    buildAbstractGraph();
  }, []);

  useEffect(() => {
    if (!imageData) return;
    buildImageGraph(imageData, density, threshold);
  }, [imageData, density, threshold]);

  useEffect(() => {
    const next = createSimNodes(nodes);
    simNodesRef.current = next;
    setSimNodes(next);
  }, [nodes]);

  useEffect(() => {
    viewportRef.current = transform;
  }, [transform]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    if (!nodes.length) return;

    function animate() {
      const currentNodes = simNodesRef.current;
      if (!currentNodes.length) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const nodeMap = new Map(currentNodes.map((node) => [node.id, node]));
      const activeDrag = dragStateRef.current;
      const connectedSet = activeDrag?.connectedSet ?? new Set();
      const draggedId = activeDrag?.nodeId ?? null;

      for (let i = 0; i < currentNodes.length; i++) {
        const node = currentNodes[i];
        if (node.grabbed) continue;

        const toBaseX = node.baseX - node.x;
        const toBaseY = node.baseY - node.y;
        node.vx += toBaseX * 0.004;
        node.vy += toBaseY * 0.004;
      }

      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);
          if (dist > 90) continue;

          const force = REPULSION / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!a.grabbed) {
            a.vx -= fx;
            a.vy -= fy;
          }
          if (!b.grabbed) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }

      links.forEach((link) => {
        const a = nodeMap.get(link.a);
        const b = nodeMap.get(link.b);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const stretch = dist - SPRING_LENGTH;
        const fx = (dx / dist) * stretch * SPRING_STRENGTH;
        const fy = (dy / dist) * stretch * SPRING_STRENGTH;

        if (!a.grabbed) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!b.grabbed) {
          b.vx -= fx;
          b.vy -= fy;
        }
      });

      if (activeDrag) {
        currentNodes.forEach((node) => {
          if (node.id === draggedId || node.grabbed) return;
          const dx = activeDrag.x - node.x;
          const dy = activeDrag.y - node.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist > INFLUENCE_RADIUS * 2.35) return;

          const connectedBoost = connectedSet.has(node.id) ? 1.85 : 0.7;
          const influence = Math.max(0, 1 - dist / (INFLUENCE_RADIUS * 2.35)) * connectedBoost;
          node.vx += (dx / dist) * influence * 0.85;
          node.vy += (dy / dist) * influence * 0.85;
        });
      }

      currentNodes.forEach((node) => {
        if (!node.grabbed) {
          node.vx *= DAMPING;
          node.vy *= DAMPING;
          node.vx = clamp(node.vx, -MAX_SPEED, MAX_SPEED);
          node.vy = clamp(node.vy, -MAX_SPEED, MAX_SPEED);
          node.x += node.vx;
          node.y += node.vy;
        }
      });

      simNodesRef.current = [...currentNodes];
      setSimNodes(simNodesRef.current);
      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [links, nodes]);

  const screenPointToWorld = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * WIDTH;
    const localY = ((clientY - rect.top) / rect.height) * HEIGHT;
    const t = viewportRef.current;
    return {
      x: (localX - t.x) / t.scale,
      y: (localY - t.y) / t.scale,
    };
  }, []);

  const handleWheel = useCallback(
    (event) => {
      event.preventDefault();
      const world = screenPointToWorld(event.clientX, event.clientY);
      setTransform((prev) => {
        const nextScale = clamp(prev.scale * (event.deltaY > 0 ? 0.92 : 1.08), 0.45, 3.5);
        return {
          x: world.x * (prev.scale - nextScale) + prev.x,
          y: world.y * (prev.scale - nextScale) + prev.y,
          scale: nextScale,
        };
      });
    },
    [screenPointToWorld]
  );

  const handleBackgroundPointerDown = useCallback((event) => {
    if (event.target.dataset.node === "true") return;
    setDragState({
      mode: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewportRef.current.x,
      originY: viewportRef.current.y,
    });
  }, []);

  const startNodeDrag = useCallback(
    (event, nodeId) => {
      event.stopPropagation();
      const world = screenPointToWorld(event.clientX, event.clientY);
      const currentNodes = simNodesRef.current;
      const selected = currentNodes.find((node) => node.id === nodeId);
      if (!selected) return;

      const connectedSet = getConnectedSet(nodeId, links);
      const groupOffsets = {};

      currentNodes.forEach((node) => {
        if (connectedSet.has(node.id)) {
          groupOffsets[node.id] = {
            x: node.x - selected.x,
            y: node.y - selected.y,
          };
        }
      });

      simNodesRef.current = currentNodes.map((node) =>
        node.id === nodeId ? { ...node, grabbed: true, vx: 0, vy: 0 } : node
      );
      setSimNodes(simNodesRef.current);
      setDragState({
        mode: "node",
        nodeId,
        x: selected.x,
        y: selected.y,
        pointerOffsetX: world.x - selected.x,
        pointerOffsetY: world.y - selected.y,
        connectedSet,
        groupOffsets,
      });
    },
    [links, screenPointToWorld]
  );

  useEffect(() => {
    function handlePointerMove(event) {
      const active = dragStateRef.current;
      if (!active) return;

      if (active.mode === "pan") {
        setTransform({
          x: active.originX + (event.clientX - active.startClientX),
          y: active.originY + (event.clientY - active.startClientY),
          scale: viewportRef.current.scale,
        });
        return;
      }

      if (active.mode === "node") {
        const world = screenPointToWorld(event.clientX, event.clientY);
        const targetX = world.x - active.pointerOffsetX;
        const targetY = world.y - active.pointerOffsetY;

        simNodesRef.current = simNodesRef.current.map((node) => {
          if (node.id === active.nodeId) {
            return { ...node, x: targetX, y: targetY, grabbed: true, vx: 0, vy: 0 };
          }

          if (active.connectedSet.has(node.id)) {
            const offset = active.groupOffsets[node.id] ?? { x: 0, y: 0 };
            const desiredX = targetX + offset.x;
            const desiredY = targetY + offset.y;
            return {
              ...node,
              vx: node.vx + (desiredX - node.x) * 0.045,
              vy: node.vy + (desiredY - node.y) * 0.045,
            };
          }

          return node;
        });

        setSimNodes([...simNodesRef.current]);
        setDragState((prev) => (prev ? { ...prev, x: targetX, y: targetY } : prev));
      }
    }

    function handlePointerUp() {
      const active = dragStateRef.current;
      if (!active) return;
      if (active.mode === "node") {
        simNodesRef.current = simNodesRef.current.map((node) =>
          node.id === active.nodeId ? { ...node, grabbed: false } : node
        );
        setSimNodes([...simNodesRef.current]);
      }
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [screenPointToWorld]);

  function buildAbstractGraph() {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const createdNodes = [];

    for (let i = 0; i < 85; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = random(70, 220) * (0.65 + Math.random() * 0.45);
      createdNodes.push({
        id: `n-${i}`,
        x: cx + Math.cos(angle) * radius + random(-35, 35),
        y: cy + Math.sin(angle) * radius + random(-35, 35),
        size: Math.random() > 0.85 ? 7 : Math.random() > 0.65 ? 5 : 3.3,
        type: Math.random() > 0.88 ? "accent" : "base",
      });
    }

    const createdLinks = buildNeighborLinks(createdNodes, 3, 5);
    const createdLabels = [];
    const keywordAnchors = [
      { text: "Prometheus", x: cx + 10, y: cy - 20 },
      { text: "Memory", x: cx + 62, y: cy + 34 },
      { text: "Notes", x: cx - 108, y: cy + 88 },
      { text: "Sessions", x: cx - 20, y: cy + 128 },
      { text: "Architecture", x: cx - 150, y: cy - 70 },
      { text: "Agents", x: cx + 120, y: cy - 98 },
    ];

    keywordAnchors.forEach((item, i) => {
      const anchor = {
        id: `label-${i}`,
        x: item.x,
        y: item.y,
        size: 8,
        type: "label",
      };
      createdNodes.push(anchor);
      createdLabels.push({ ...item, nodeId: anchor.id });
    });

    const withLabelsLinks = [...createdLinks];
    keywordAnchors.forEach((_, i) => {
      const anchorId = `label-${i}`;
      const anchor = createdNodes.find((node) => node.id === anchorId);
      const closest = createdNodes
        .filter((node) => node.id !== anchorId)
        .map((node) => ({ id: node.id, d: Math.hypot(anchor.x - node.x, anchor.y - node.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4);
      closest.forEach((item) => withLabelsLinks.push({ a: anchorId, b: item.id }));
    });

    setNodes(createdNodes);
    setLinks(withLabelsLinks);
    setLabels(createdLabels);
    setTransform({ x: 0, y: 0, scale: 1 });
    setStatus("Interactive knowledge web ready. Drag nodes, pan the canvas, or zoom in to explore the weave.");
  }

  function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setImageData(img);
        setStatus(`Loaded ${file.name}. Building graph silhouette...`);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function buildImageGraph(img, pointBudget = 750, alphaThreshold = 180) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sampleW = 220;
    const scale = sampleW / img.width;
    const sampleH = Math.max(100, Math.round(img.height * scale));
    canvas.width = sampleW;
    canvas.height = sampleH;

    ctx.clearRect(0, 0, sampleW, sampleH);
    ctx.drawImage(img, 0, 0, sampleW, sampleH);

    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    const maskPoints = [];

    for (let y = 0; y < sampleH; y += 2) {
      for (let x = 0; x < sampleW; x += 2) {
        const idx = (y * sampleW + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (a > 20 && luminance < alphaThreshold) maskPoints.push({ x, y });
      }
    }

    if (maskPoints.length < 30) {
      setStatus("Could not detect a strong dark silhouette. Try a higher-contrast image or lower the threshold.");
      return;
    }

    const picked = [];
    const step = Math.max(1, Math.floor(maskPoints.length / pointBudget));
    for (let i = 0; i < maskPoints.length; i += step) {
      picked.push(maskPoints[i]);
      if (picked.length >= pointBudget) break;
    }

    const minX = Math.min(...picked.map((p) => p.x));
    const maxX = Math.max(...picked.map((p) => p.x));
    const minY = Math.min(...picked.map((p) => p.y));
    const maxY = Math.max(...picked.map((p) => p.y));
    const boxW = maxX - minX || 1;
    const boxH = maxY - minY || 1;
    const fit = Math.min((WIDTH - 180) / boxW, (HEIGHT - 140) / boxH);

    const createdNodes = picked.map((p, i) => ({
      id: `img-${i}`,
      x: (p.x - minX) * fit + (WIDTH - boxW * fit) / 2 + random(-2.5, 2.5),
      y: (p.y - minY) * fit + (HEIGHT - boxH * fit) / 2 + random(-2.5, 2.5),
      size: Math.random() > 0.93 ? 5.2 : 2.8,
      type: Math.random() > 0.92 ? "accent" : "base",
    }));

    const createdLinks = buildNeighborLinks(createdNodes, 2, 3);
    const prominent = createdNodes
      .filter((_, i) => i % Math.max(1, Math.floor(createdNodes.length / Math.min(defaultKeywords.length, 14))) === 0)
      .slice(0, 10);

    const createdLabels = prominent.map((node, i) => ({
      text: defaultKeywords[i % defaultKeywords.length],
      x: node.x + 10,
      y: node.y - 8,
      nodeId: node.id,
    }));

    setNodes(createdNodes);
    setLinks(createdLinks);
    setLabels(createdLabels);
    setTransform({ x: 0, y: 0, scale: 1 });
    setStatus(`Custom interactive silhouette built with ${createdNodes.length} nodes. Drag any cluster and the weave ripples through the rest.`);
  }

  function exportSVG() {
    const svg = svgRef.current;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prometheus-memory-graph.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  const nodeMap = useMemo(() => Object.fromEntries(simNodes.map((n) => [n.id, n])), [simNodes]);
  const connectedHoverSet = useMemo(() => {
    if (!hoveredNodeId) return new Set();
    return getConnectedSet(hoveredNodeId, links);
  }, [hoveredNodeId, links]);

  return (
    <div className="min-h-screen bg-[#06080d] text-white p-6 md:p-10">
      <div className="mx-auto max-w-7xl grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-5 shadow-2xl">
          <div className="mb-5">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Prometheus</div>
            <h1 className="mt-2 text-2xl font-semibold">Memory Graph Demo</h1>
            <p className="mt-3 text-sm leading-6 text-white/65">
              The graph is now fully interactive: drag node clusters like woven strands, pan the whole canvas, and zoom smoothly into dense memory webs.
            </p>
          </div>

          <div className="space-y-5">
            <label className="block rounded-2xl border border-dashed border-emerald-400/30 bg-emerald-400/5 p-4 cursor-pointer hover:bg-emerald-400/10 transition">
              <div className="text-sm font-medium">Upload image</div>
              <div className="mt-1 text-xs text-white/55">Use any high-contrast image to remap the node field into a custom silhouette.</div>
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>

            <div>
              <div className="flex items-center justify-between text-xs text-white/60 mb-2">
                <span>Node density</span>
                <span>{density}</span>
              </div>
              <input
                type="range"
                min="150"
                max="1600"
                step="50"
                value={density}
                onChange={(e) => setDensity(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-white/60 mb-2">
                <span>Silhouette threshold</span>
                <span>{threshold}</span>
              </div>
              <input
                type="range"
                min="60"
                max="245"
                step="5"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
              <span>Show outline glow</span>
              <input type="checkbox" checked={showHull} onChange={(e) => setShowHull(e.target.checked)} className="accent-emerald-400" />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
              <span>Pulse active nodes</span>
              <input type="checkbox" checked={pulse} onChange={(e) => setPulse(e.target.checked)} className="accent-emerald-400" />
            </label>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-white/60">
              {status}
            </div>

            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4 text-xs leading-6 text-white/60">
              Drag background to pan. Scroll to zoom. Drag a node to pull the connected weave while untouched dots still react to the motion.
            </div>

            <div className="flex gap-3">
              <button
                onClick={buildAbstractGraph}
                className="flex-1 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm hover:bg-white/12 transition"
              >
                Reset graph
              </button>
              <button
                onClick={exportSVG}
                className="flex-1 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm hover:bg-emerald-400/15 transition"
              >
                Export SVG
              </button>
            </div>
          </div>
        </aside>

        <main className="rounded-[28px] border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.02] shadow-2xl overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.14),transparent_42%)]" />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="relative h-[78vh] w-full cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onPointerDown={handleBackgroundPointerDown}
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3.6" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {showHull && simNodes.length > 10 && (
                <g opacity="0.16" filter="url(#glow)">
                  {simNodes.map((n, i) => {
                    const next = simNodes[(i + 11) % simNodes.length];
                    return (
                      <line
                        key={`halo-${n.id}`}
                        x1={n.x}
                        y1={n.y}
                        x2={next.x}
                        y2={next.y}
                        stroke="rgba(16,185,129,0.22)"
                        strokeWidth="0.7"
                      />
                    );
                  })}
                </g>
              )}

              <g opacity="0.46">
                {links.map((link, i) => {
                  const a = nodeMap[link.a];
                  const b = nodeMap[link.b];
                  if (!a || !b) return null;
                  const emphasized = hoveredNodeId && connectedHoverSet.has(a.id) && connectedHoverSet.has(b.id);
                  return (
                    <line
                      key={`${link.a}-${link.b}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={
                        emphasized
                          ? "rgba(34,197,94,0.8)"
                          : a.type === "accent" || b.type === "accent"
                          ? "rgba(16,185,129,0.45)"
                          : "rgba(255,255,255,0.24)"
                      }
                      strokeWidth={emphasized ? 1.5 : a.type === "accent" || b.type === "accent" ? 1.05 : 0.9}
                    />
                  );
                })}
              </g>

              <g>
                {simNodes.map((node) => {
                  const highlighted = hoveredNodeId ? connectedHoverSet.has(node.id) : false;
                  return (
                    <g key={node.id}>
                      {pulse && node.type === "accent" && (
                        <circle cx={node.x} cy={node.y} r={node.size + 5} fill="rgba(16,185,129,0.10)">
                          <animate attributeName="r" values={`${node.size + 3};${node.size + 8};${node.size + 3}`} dur="2.8s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.24;0.06;0.24" dur="2.8s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle
                        data-node="true"
                        cx={node.x}
                        cy={node.y}
                        r={highlighted ? node.size + 1.8 : node.size}
                        fill={
                          node.type === "accent"
                            ? "#22c55e"
                            : node.type === "label"
                            ? "#ffffff"
                            : highlighted
                            ? "rgba(255,255,255,0.98)"
                            : "rgba(255,255,255,0.72)"
                        }
                        filter={node.type === "accent" || highlighted ? "url(#glow)" : undefined}
                        className="cursor-pointer transition-all duration-150"
                        onPointerDown={(event) => startNodeDrag(event, node.id)}
                        onPointerEnter={() => setHoveredNodeId(node.id)}
                        onPointerLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                      />
                    </g>
                  );
                })}
              </g>

              <g>
                {labels.map((label) => {
                  const anchor = nodeMap[label.nodeId];
                  const x = anchor ? anchor.x + 10 : label.x;
                  const y = anchor ? anchor.y - 8 : label.y;
                  return (
                    <text
                      key={`${label.nodeId}-${label.text}`}
                      x={x}
                      y={y}
                      fill="rgba(255,255,255,0.9)"
                      fontSize="14"
                      fontFamily="Inter, ui-sans-serif, system-ui"
                    >
                      {label.text}
                    </text>
                  );
                })}
              </g>
            </g>
          </svg>
        </main>
      </div>
    </div>
  );
}
