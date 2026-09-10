// Bildaufbereitung: Handyfotos von Befunden sind 4–8 MB. Das Repo würde das
// überleben, der Sync über Mobilfunk nicht. Also runterrechnen — aber nur so weit,
// dass Arztbriefe noch lesbar bleiben.

const THUMB_PX = 320;

async function decode(blob) {
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch { /* HEIC o.ä. */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    img.src = url;
  });
}

function draw(src, maxPx) {
  const w = src.width, h = src.height;
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  return { canvas, width: cw, height: ch };
}

const toBlob = (canvas, quality) => new Promise(res =>
  canvas.toBlob(b => res(b), 'image/jpeg', quality));

/**
 * @returns {{blob:Blob, thumb:Blob|null, width:number, height:number, mime:string, converted:boolean}}
 * Bei nicht dekodierbaren Formaten (HEIC in Chrome) bleibt das Original erhalten,
 * statt den Upload zu verlieren.
 */
export async function prepareImage(file, { maxPx = 2048, quality = 0.85 } = {}) {
  try {
    const src = await decode(file);
    const full = draw(src, maxPx);
    const thumbC = draw(src, THUMB_PX);
    const [blob, thumb] = await Promise.all([
      toBlob(full.canvas, quality),
      toBlob(thumbC.canvas, 0.7)
    ]);
    if (src.close) src.close();
    if (!blob) throw new Error('encode');
    // Wenn die Kompression nichts bringt, lieber das Original behalten.
    if (blob.size >= file.size && file.type === 'image/jpeg') {
      return { blob: file, thumb, width: full.width, height: full.height, mime: file.type, converted: false };
    }
    return { blob, thumb, width: full.width, height: full.height, mime: 'image/jpeg', converted: true };
  } catch {
    return { blob: file, thumb: null, width: 0, height: 0, mime: file.type || 'application/octet-stream', converted: false };
  }
}

const urls = new Map();
export function objectUrl(key, blob) {
  if (urls.has(key)) return urls.get(key);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}
export function releaseUrl(key) {
  const url = urls.get(key);
  if (url) { URL.revokeObjectURL(url); urls.delete(key); }
}
