/**
 * Liquid Glass — SDF rim refraction compositor.
 * Locked default spec from the Prometheus demo:
 * rim 32, strength 20, chroma 0.7, spec 0.28, fill 0.1, blur 2.5
 */

export const DEFAULT_SPEC = Object.freeze({
  rim: 32,
  strength: 20,
  chroma: 0.7,
  spec: 0.28,
  fill: 0.1,
  blur: 2.5,
});

export function sdRoundBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

export function smooth(x, a, b) {
  const t = Math.max(0, Math.min(1, (x - a) / ((b - a) || 1)));
  return t * t * (3 - 2 * t);
}

export function sampleBilinear(data, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const a = (1 - fx) * (1 - fy);
  const b = fx * (1 - fy);
  const c = (1 - fx) * fy;
  const d = fx * fy;
  return [
    data[i00] * a + data[i10] * b + data[i01] * c + data[i11] * d,
    data[i00 + 1] * a + data[i10 + 1] * b + data[i01 + 1] * c + data[i11 + 1] * d,
    data[i00 + 2] * a + data[i10 + 2] * b + data[i01 + 2] * c + data[i11 + 2] * d,
  ];
}

export function blurBackdrop(src, w, h, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xk = Math.max(0, Math.min(w - 1, k));
        acc += src[(y * w + xk) * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = acc / span;
        const drop = Math.max(0, Math.min(w - 1, x - r));
        const add = Math.max(0, Math.min(w - 1, x + r + 1));
        acc += src[(y * w + add) * 4 + c] - src[(y * w + drop) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yk = Math.max(0, Math.min(h - 1, k));
        acc += tmp[(yk * w + x) * 4 + c];
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = acc / span;
        const drop = Math.max(0, Math.min(h - 1, y - r));
        const add = Math.max(0, Math.min(h - 1, y + r + 1));
        acc += tmp[(add * w + x) * 4 + c] - tmp[(drop * w + x) * 4 + c];
      }
    }
  }
  return out;
}

export function renderLiquidGlass(opts) {
  const {
    sceneCtx,
    glassCtx,
    x,
    y,
    width,
    height,
    spec = DEFAULT_SPEC,
  } = opts;

  const canvas = glassCtx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  glassCtx.clearRect(0, 0, w, h);

  const cx = x;
  const cy = y;
  const hx = width * 0.5;
  const hy = height * 0.5;
  const radius = hy;
  const rim = spec.rim;
  const str = spec.strength;
  const chr = spec.chroma;
  const specAmt = spec.spec;
  const fill = spec.fill;
  const blur = spec.blur;
  const pad = Math.ceil(str + blur * 2 + 10);
  const x0 = Math.max(0, (cx - hx - pad) | 0);
  const y0 = Math.max(0, (cy - hy - pad) | 0);
  const x1 = Math.min(w, Math.ceil(cx + hx + pad));
  const y1 = Math.min(h, Math.ceil(cy + hy + pad));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 4 || bh < 4) return;

  const src = blurBackdrop(sceneCtx.getImageData(x0, y0, bw, bh).data, bw, bh, blur);
  const out = glassCtx.createImageData(bw, bh);
  const dst = out.data;
  const e = 0.85;

  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      const px = x0 + lx + 0.5 - cx;
      const py = y0 + ly + 0.5 - cy;
      const d = sdRoundBox(px, py, hx, hy, radius);
      if (d > 1.25) continue;

      const rimW = 1 - smooth(Math.abs(d), 0, rim);
      const warpAmt = Math.pow(Math.max(rimW, 0), 1.08);

      let nx = sdRoundBox(px + e, py, hx, hy, radius) - sdRoundBox(px - e, py, hx, hy, radius);
      let ny = sdRoundBox(px, py + e, hx, hy, radius) - sdRoundBox(px, py - e, hx, hy, radius);
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;

      const pull = str * warpAmt;
      const ox = -nx * pull;
      const oy = -ny * pull;

      const sx = lx + ox;
      const sy = ly + oy;
      const split = chr * warpAmt;
      const r = sampleBilinear(src, bw, bh, sx - split * nx, sy - split * ny)[0];
      const g = sampleBilinear(src, bw, bh, sx, sy)[1];
      const b = sampleBilinear(src, bw, bh, sx + split * nx, sy + split * ny)[2];

      const body = 0.07 + fill * 0.55;
      let rr = r * (1 - body) + 18 * body;
      let gg = g * (1 - body) + 22 * body;
      let bb = b * (1 - body) + 28 * body;

      const hair = 1 - smooth(Math.abs(d), 0, 1.35);
      const tb = Math.pow(Math.abs(ny), 6);
      const stroke = hair * tb * (0.16 + specAmt * 0.12);
      rr += 255 * stroke;
      gg += 252 * stroke;
      bb += 248 * stroke;

      const ndl = Math.max(0, -nx * 0.18 - ny * 0.82);
      const add = Math.pow(ndl, 22) * hair * specAmt * 22;
      rr += add;
      gg += add;
      bb += add;

      const i = (ly * bw + lx) * 4;
      dst[i] = Math.min(255, rr);
      dst[i + 1] = Math.min(255, gg);
      dst[i + 2] = Math.min(255, bb);
      dst[i + 3] = (1 - smooth(d, 0, 1.25)) * 255;
    }
  }
  glassCtx.putImageData(out, x0, y0);
}

export function mountLiquidGlass(container, options = {}) {
  const spec = { ...DEFAULT_SPEC, ...(options.spec || {}) };
  const scene = document.createElement("canvas");
  const glass = document.createElement("canvas");
  scene.className = "lg-scene";
  glass.className = "lg-glass";
  Object.assign(container.style, {
    position: container.style.position || "relative",
    overflow: "hidden",
  });
  Object.assign(scene.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  Object.assign(glass.style, { position: "absolute", inset: "0", width: "100%", height: "100%", touchAction: "none" });
  container.append(scene, glass);

  const sceneCtx = scene.getContext("2d", { willReadFrequently: true });
  const glassCtx = glass.getContext("2d");
  const state = {
    x: options.x ?? 0.5,
    y: options.y ?? 0.38,
    w: options.w ?? 0.84,
    h: options.h ?? 0.08,
    dragging: false,
  };

  function resize() {
    const r = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.floor(r.width * dpr));
    const H = Math.max(2, Math.floor(r.height * dpr));
    scene.width = W;
    scene.height = H;
    glass.width = W;
    glass.height = H;
    if (options.drawScene) options.drawScene(sceneCtx, W, H);
  }

  function loop() {
    const W = glass.width;
    const H = glass.height;
    renderLiquidGlass({
      sceneCtx,
      glassCtx,
      x: state.x * W,
      y: state.y * H,
      width: state.w * W,
      height: state.h * H,
      spec,
    });
    requestAnimationFrame(loop);
  }

  glass.addEventListener("pointerdown", (e) => {
    const r = glass.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (Math.abs(x - state.x) < state.w / 2 && Math.abs(y - state.y) < state.h / 2 + 0.05) {
      state.dragging = true;
      try { glass.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  glass.addEventListener("pointermove", (e) => {
    if (!state.dragging) return;
    const r = glass.getBoundingClientRect();
    state.x = Math.min(0.92, Math.max(0.08, (e.clientX - r.left) / r.width));
    state.y = Math.min(0.84, Math.max(0.10, (e.clientY - r.top) / r.height));
  });
  glass.addEventListener("pointerup", () => { state.dragging = false; });
  addEventListener("resize", resize);
  resize();
  loop();
  return { scene, glass, state, spec, resize };
}
