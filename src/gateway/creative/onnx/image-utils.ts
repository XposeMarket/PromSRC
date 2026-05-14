import Jimp from 'jimp';

export type RGBA = { r: number; g: number; b: number; a: number };

export async function loadJimp(absPath: string): Promise<Jimp> {
  return Jimp.read(absPath);
}

export async function loadJimpFromBuffer(buf: Buffer): Promise<Jimp> {
  return Jimp.read(buf);
}

export function jimpToFloat32CHW(image: Jimp, opts: { width: number; height: number; mean?: [number, number, number]; std?: [number, number, number] }): Float32Array {
  const { width, height } = opts;
  const mean = opts.mean ?? [0, 0, 0];
  const std = opts.std ?? [1, 1, 1];
  const resized = image.clone().resize(width, height, Jimp.RESIZE_BILINEAR);
  const out = new Float32Array(3 * width * height);
  const planeSize = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = resized.bitmap.data[idx];
      const g = resized.bitmap.data[idx + 1];
      const b = resized.bitmap.data[idx + 2];
      const i = y * width + x;
      out[i] = (r - mean[0]) / std[0];
      out[i + planeSize] = (g - mean[1]) / std[1];
      out[i + 2 * planeSize] = (b - mean[2]) / std[2];
    }
  }
  return out;
}

export function jimpToNormalizedCHW(image: Jimp, width: number, height: number): Float32Array {
  return jimpToFloat32CHW(image, { width, height, mean: [0, 0, 0], std: [255, 255, 255] });
}

export function jimpToImagenetCHW(image: Jimp, width: number, height: number): Float32Array {
  return jimpToFloat32CHW(image, {
    width,
    height,
    mean: [123.675, 116.28, 103.53],
    std: [58.395, 57.12, 57.375],
  });
}

export function maskToPng(mask: Uint8Array | Float32Array, width: number, height: number, threshold = 0.5): Promise<Buffer> {
  const img = new Jimp(width, height, 0x00000000);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x];
      const on = (typeof v === 'number' ? v : v) > threshold;
      const idx = (y * width + x) * 4;
      img.bitmap.data[idx] = 255;
      img.bitmap.data[idx + 1] = 255;
      img.bitmap.data[idx + 2] = 255;
      img.bitmap.data[idx + 3] = on ? 255 : 0;
    }
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

export async function applyMaskToImage(imageAbsPath: string, mask: Float32Array | Uint8Array, maskWidth: number, maskHeight: number, threshold = 0.5): Promise<{ buffer: Buffer; bbox: { x: number; y: number; width: number; height: number } | null; width: number; height: number }> {
  const img = await Jimp.read(imageAbsPath);
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const scaleX = maskWidth / W;
  const scaleY = maskHeight / H;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const my = Math.min(maskHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(maskWidth - 1, Math.floor(x * scaleX));
      const v = mask[my * maskWidth + mx];
      const on = v > threshold;
      const idx = (y * W + x) * 4;
      if (on) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        img.bitmap.data[idx + 3] = 0;
      }
    }
  }
  let bbox: { x: number; y: number; width: number; height: number } | null = null;
  if (maxX >= 0 && maxY >= 0) {
    const cropped = img.clone().crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
    bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    return { buffer: await cropped.getBufferAsync(Jimp.MIME_PNG), bbox, width: img.bitmap.width, height: img.bitmap.height };
  }
  return { buffer: await img.getBufferAsync(Jimp.MIME_PNG), bbox, width: img.bitmap.width, height: img.bitmap.height };
}

export async function applyAlphaMaskToImage(imageAbsPath: string, mask: Uint8Array, maskWidth: number, maskHeight: number, threshold = 8): Promise<{ buffer: Buffer; bbox: { x: number; y: number; width: number; height: number } | null; width: number; height: number }> {
  const img = await Jimp.read(imageAbsPath);
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const scaleX = maskWidth / W;
  const scaleY = maskHeight / H;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const my = Math.min(maskHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(maskWidth - 1, Math.floor(x * scaleX));
      const alpha = mask[my * maskWidth + mx] || 0;
      const idx = (y * W + x) * 4;
      img.bitmap.data[idx + 3] = alpha;
      if (alpha >= threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX >= 0 && maxY >= 0) {
    const cropped = img.clone().crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
    return {
      buffer: await cropped.getBufferAsync(Jimp.MIME_PNG),
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      width: img.bitmap.width,
      height: img.bitmap.height,
    };
  }
  return { buffer: await img.getBufferAsync(Jimp.MIME_PNG), bbox: null, width: img.bitmap.width, height: img.bitmap.height };
}

export function unionMasks(masks: { mask: Float32Array | Uint8Array; width: number; height: number; threshold?: number; padPx?: number }[], targetWidth: number, targetHeight: number): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  for (const entry of masks) {
    const sx = entry.width / targetWidth;
    const sy = entry.height / targetHeight;
    const t = entry.threshold ?? 0.5;
    const pad = Math.max(0, Math.round(entry.padPx || 0));
    for (let y = 0; y < targetHeight; y++) {
      const my = Math.min(entry.height - 1, Math.floor(y * sy));
      for (let x = 0; x < targetWidth; x++) {
        const mx = Math.min(entry.width - 1, Math.floor(x * sx));
        const v = entry.mask[my * entry.width + mx];
        if (v > t) out[y * targetWidth + x] = 255;
      }
    }
    if (pad > 0) dilate(out, targetWidth, targetHeight, pad);
  }
  return out;
}

export function dilate(mask: Uint8Array, width: number, height: number, iterations: number): void {
  const buf = new Uint8Array(mask);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (buf[y * width + x]) continue;
        const u = y > 0 && buf[(y - 1) * width + x];
        const d = y < height - 1 && buf[(y + 1) * width + x];
        const l = x > 0 && buf[y * width + (x - 1)];
        const r = x < width - 1 && buf[y * width + (x + 1)];
        if (u || d || l || r) mask[y * width + x] = 255;
      }
    }
    buf.set(mask);
  }
}

export async function pixelSampleColor(image: Jimp, x: number, y: number, width: number, height: number): Promise<RGBA> {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  const W = image.bitmap.width;
  const H = image.bitmap.height;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.floor(x + width));
  const y1 = Math.min(H, Math.floor(y + height));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const idx = (yy * W + xx) * 4;
      r += image.bitmap.data[idx];
      g += image.bitmap.data[idx + 1];
      b += image.bitmap.data[idx + 2];
      a += image.bitmap.data[idx + 3];
      n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
}

export function rgbaToHex(c: RGBA, includeAlpha = false): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return includeAlpha ? `#${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}` : `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function relativeLuminance(c: RGBA): number {
  const norm = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(c.r) + 0.7152 * norm(c.g) + 0.0722 * norm(c.b);
}

export async function chwFloat32ToPngBuffer(data: Float32Array, width: number, height: number, scale = 255): Promise<Buffer> {
  const img = new Jimp(width, height, 0xff);
  const planeSize = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = i * 4;
      const r = Math.max(0, Math.min(255, Math.round(data[i] * scale)));
      const g = Math.max(0, Math.min(255, Math.round(data[i + planeSize] * scale)));
      const b = Math.max(0, Math.min(255, Math.round(data[i + 2 * planeSize] * scale)));
      img.bitmap.data[idx] = r;
      img.bitmap.data[idx + 1] = g;
      img.bitmap.data[idx + 2] = b;
      img.bitmap.data[idx + 3] = 255;
    }
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}
