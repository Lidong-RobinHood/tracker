// Client-side downscaling of a meal photo before upload (long edge ≤ 1568 px, JPEG).
// Errors carry `key`: a catalogue key (namespace food) for the UI; the message is for logs.

/** Error with a catalogue key. */
function keyError(key, message) {
  const e = new Error(message);
  e.key = key;
  return e;
}
export const LONG_EDGE = 1568;
export const JPEG_QUALITY = 0.85;

/** Decode an image file, respecting EXIF orientation. */
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale to at most LONG_EDGE on the long side and re-encode as JPEG.
 * @param {Blob} blob
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function prepareImage(blob) {
  let src;
  try { src = await decode(blob); } catch { throw keyError('food.photo.unreadable', 'not readable as an image'); } // i18n-ignore (log message)
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw keyError('food.photo.unreadable', 'image without size'); // i18n-ignore (log message)
  const f = Math.min(1, LONG_EDGE / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * f));
  const height = Math.max(1, Math.round(h0 * f));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs → white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  if (src.close) src.close();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!out) throw keyError('food.photo.prepareFailed', 'canvas.toBlob returned null'); // i18n-ignore (log message)
  return { blob: out, width, height };
}

/** Blob → base64 string (no data: prefix). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
