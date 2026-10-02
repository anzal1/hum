// Pull a handful of characterful colours out of a cover so the whole room can wear them.
const cache = new Map();

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function palette(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 36;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 36, 36);
        const px = ctx.getImageData(0, 0, 36, 36).data;
        const buckets = new Map();
        for (let i = 0; i < px.length; i += 4) {
          const key = (px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4);
          const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
          buckets.set(key, b);
        }
        const ranked = [...buckets.values()]
          .map((b) => {
            const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
            const [, s, l] = rgbToHsl(rgb);
            return { rgb, score: b.n * (0.25 + s * 1.6) * (l < 0.07 || l > 0.95 ? 0.15 : 1) };
          })
          .sort((a, b) => b.score - a.score);
        const picks = [];
        for (const r of ranked) {
          if (picks.every((p) => dist(p, r.rgb) > 58)) picks.push(r.rgb);
          if (picks.length === 4) break;
        }
        while (picks.length < 4) {
          const [h, s, l] = rgbToHsl(picks[0] || [90, 60, 140]);
          picks.push(hslToRgb([(h + 0.08 * picks.length) % 1, s, l]));
        }
        // Lift into a glowing but dark range so text always reads on top.
        const glow = picks.map((rgb, i) => {
          const [h, s, l] = rgbToHsl(rgb);
          return hslToRgb([h, Math.max(s, 0.38), i === 3 ? 0.07 : Math.min(Math.max(l, 0.3), 0.52)]);
        });
        const vivid = [...picks].sort((a, b) => rgbToHsl(b)[1] - rgbToHsl(a)[1])[0];
        const [ah, as] = rgbToHsl(vivid);
        resolve({ colors: glow, accent: hslToRgb([ah, Math.max(as, 0.55), 0.7]) });
      } catch {
        resolve(null);
      }
    };
    img.src = url;
  });
  cache.set(url, job);
  return job;
}
