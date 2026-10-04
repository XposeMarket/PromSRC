// Full-size phone screenshots/photos are 10-16 MB of base64: uploads fail on
// the tunnel and providers reject them (Anthropic caps images at 10 MB).
// Downscale on device before upload. Returns null when the image is already
// small enough (sent untouched) or cannot be decoded.
const MOBILE_IMAGE_MAX_EDGE = 2000;
const MOBILE_IMAGE_MAX_BYTES = 1_500_000;

export async function shrinkMobileImageFile(file) {
  if (!file || /gif|svg/i.test(file.type || '')) return null;
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file)
    : await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  const w = bitmap.width || bitmap.naturalWidth || 0;
  const h = bitmap.height || bitmap.naturalHeight || 0;
  if (!w || !h) return null;
  if (Math.max(w, h) <= MOBILE_IMAGE_MAX_EDGE && (file.size || 0) <= MOBILE_IMAGE_MAX_BYTES) {
    bitmap.close?.();
    return null;
  }
  const scale = Math.min(1, MOBILE_IMAGE_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  if (dataUrl.length > MOBILE_IMAGE_MAX_BYTES * 1.37) dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  return { dataUrl, mimeType: 'image/jpeg', bytes: Math.round((dataUrl.length - 23) * 0.75) };
}
