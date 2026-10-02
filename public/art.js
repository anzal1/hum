// Generative cover art for anything without a real cover, and a live favicon.
import { sized } from './engine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Flowing sound-wave lines, unique per seed.
export function waves(seed, { lines = 11, opacity = 0.55 } = {}) {
  const r = rng(hash(seed));
  const amp = 8 + r() * 18, freq = 1.2 + r() * 2.2, drift = r() * Math.PI * 2, tilt = (r() - 0.5) * 40;
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const y0 = 30 + (i * 150) / (lines - 1);
    const a = amp * (0.35 + Math.sin((i / lines) * Math.PI) * 0.9);
    let d = '';
    for (let x = -20; x <= 220; x += 10) {
      const y = y0 + Math.sin((x / 200) * Math.PI * freq + drift + i * 0.35) * a + ((x - 100) / 200) * tilt;
      d += `${x === -20 ? 'M' : 'L'}${x} ${y.toFixed(1)}`;
    }
    paths.push(`<path d="${d}" stroke-opacity="${(opacity * (0.35 + 0.65 * Math.sin((i / (lines - 1)) * Math.PI))).toFixed(2)}"/>`);
  }
  return `<svg class="waves" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round">${paths.join('')}</g></svg>`;
}

// ---------- covers painted by the same light shader as the background ----------

const FRAG = `
precision highp float;
uniform vec2 r; uniform float t; uniform float seed;
uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 c4;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*n(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5*r) / min(r.x, r.y);
  float a = seed * 6.2831;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p * (1.0 + fract(seed * 7.0) * 0.6) + seed * 17.0;
  float T = t * 0.05;
  vec2 q = vec2(fbm(p*0.8 + vec2(0.0, T)), fbm(p*0.8 + vec2(5.2, -T)));
  vec2 w = vec2(fbm(p*1.0 + 2.0*q + vec2(1.7, 9.2) + T*1.3), fbm(p*1.0 + 2.0*q + vec2(8.3, 2.8) - T));
  float f = fbm(p*0.95 + 2.4*w);
  vec3 col = mix(c4, c3, smoothstep(0.05, 0.5, f));
  col = mix(col, c2, smoothstep(0.25, 0.8, length(w) * 0.95));
  col = mix(col, c1, smoothstep(0.42, 0.95, f * 1.25 + q.y * 0.25));
  vec2 pc = (gl_FragCoord.xy - 0.5*r) / min(r.x, r.y);
  vec2 lp = vec2(-0.22 + 0.08*sin(T*4.0 + seed*9.0), 0.26 + 0.06*cos(T*3.0));
  col += mix(c1, vec3(1.0), 0.25) * pow(max(0.0, 1.0 - length(pc - lp) * 1.2), 3.0) * 0.75;
  col *= mix(0.68, 1.06, smoothstep(1.1, 0.1, length(pc * vec2(0.9, 1.0))));
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.35);
  col = pow(max(col, 0.0), vec3(1.12)) * 0.96;
  col += (h(gl_FragCoord.xy + fract(t * 0.37) * 91.0) - 0.5) * 0.045;
  gl_FragColor = vec4(col, 1.0);
}`;

const hsl = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => ((t = (t + 1) % 1), t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);

// Palette for an art canvas: data-hues="h1,h2,h3" or data-colors="#a,#b,#c".
function paletteOf(el) {
  if (el.dataset.colors) {
    const [a, b, c] = el.dataset.colors.split(',').map(hex);
    return [a, b, a.map((v, i) => (v + b[i]) * 0.5), c];
  }
  const [h1, h2, h3] = el.dataset.hues.split(',').map(Number);
  return [hsl(h1, 0.95, 0.66), hsl(h2, 0.88, 0.52), hsl(h3, 0.75, 0.34), hsl(h3, 0.6, 0.07)];
}

let painter;
function getPainter() {
  if (painter !== undefined) return painter;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return (painter = null);
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['r', 't', 'seed', 'c1', 'c2', 'c3', 'c4'].map((k) => [k, gl.getUniformLocation(prog, k)]));
  painter = (target, time) => {
    const w = target.width, h = target.height;
    if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h), gl.viewport(0, 0, w, h);
    const pal = target._pal || (target._pal = paletteOf(target));
    gl.uniform2f(u.r, w, h);
    gl.uniform1f(u.t, time);
    gl.uniform1f(u.seed, (hash(target.dataset.seed || '') % 1000) / 1000);
    ['c1', 'c2', 'c3', 'c4'].forEach((k, i) => gl.uniform3fv(u[k], pal[i]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    target.getContext('2d').drawImage(canvas, 0, 0);
  };
  return painter;
}

function sizeCanvas(c) {
  const rect = c.getBoundingClientRect();
  if (!rect.width) return false;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = Math.min(720, Math.round(rect.width * dpr));
  c.height = Math.min(720, Math.round(rect.height * dpr));
  return true;
}
const baseTime = (c) => 20 + (hash(c.dataset.seed || '') % 400) / 10;

// Paint each art canvas once, when it scrolls into view.
const seen = typeof IntersectionObserver !== 'undefined' &&
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      paintOne(e.target);
    }
  }, { rootMargin: '200px' });
function paintOne(c) {
  const paint = getPainter();
  if (!paint || !sizeCanvas(c)) return;
  paint(c, baseTime(c));
  c.classList.add('painted');
}
export function paintArt(root = document) {
  root.querySelectorAll('canvas.art:not(.painted)').forEach((c) => (seen ? seen.observe(c) : paintOne(c)));
}

// The cover you hover comes alive.
export function initArtMotion(root = document) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let live = null, raf = 0, t = 0, last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!live || now - last < 33) return;
    t += (now - last) / 1000 * 2.2;
    last = now;
    getPainter()?.(live, t);
  };
  root.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.station, .pl-card, .pl-hero-cover')?.querySelector('canvas.art.painted');
    if (c === live) return;
    live = c;
    if (c) {
      t = baseTime(c);
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(loop);
    }
  });
  root.addEventListener('pointerleave', () => (live = null));
}

const artCanvas = (seed, attr) => `<canvas class="art" data-seed="${esc(seed)}" ${attr} aria-hidden="true"></canvas>`;

// A full cover: the light field plus the name set in serif.
export function genArt(seed, { label = '', hues } = {}) {
  const h = hash(seed);
  const r = rng(h);
  const [h1, h2, h3] = hues || [h % 360, (h % 360) + 35 + r() * 70, (h % 360) + 170 + r() * 60];
  return `<div class="gen-art" style="--h1:${h1};--h2:${h2 % 360};--h3:${h3 % 360};--x1:30%;--y1:25%;--x2:75%;--y2:75%">
    ${artCanvas(seed, `data-hues="${h1},${h2 % 360},${h3 % 360}"`)}
    ${label ? `<span class="gen-label">${esc(label)}</span>` : ''}
  </div>`;
}

export const likedArt = (heartSvg) =>
  `<div class="gen-art liked-art" style="--h1:340;--h2:285;--h3:260;--x1:28%;--y1:22%;--x2:78%;--y2:84%">${artCanvas('liked songs', 'data-hues="335,285,255"')}<span class="liked-heart">${heartSvg}</span></div>`;

export const stationArt = (name, colors) => artCanvas(name, `data-colors="${colors.join(',')}"`);

// ---------- live favicon: the cover with dancing bars while music plays ----------

export class Favicon {
  constructor() {
    this.link = document.querySelector('link[rel="icon"]');
    this.base = this.link?.href;
    this.c = document.createElement('canvas');
    this.c.width = this.c.height = 64;
    this.ctx = this.c.getContext('2d');
    this.img = null;
    this.playing = false;
    this.t = 0;
  }
  setTrack(t) {
    const url = t?.art ? sized(t.art, 120) : '';
    const fallback = t?.id ? `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg` : '';
    const load = (src, next) => {
      if (!src) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => ((this.img = img), this.draw());
      img.onerror = () => next && load(next);
      img.src = src;
    };
    load(url, fallback);
  }
  setPlaying(on) {
    this.playing = on;
    clearInterval(this.timer);
    if (on) this.timer = setInterval(() => this.draw(), 140);
    this.draw();
  }
  reset() {
    clearInterval(this.timer);
    if (this.link && this.base) this.link.href = this.base;
  }
  draw() {
    if (!this.img || !this.link) return;
    const { ctx } = this;
    this.t += 0.14;
    ctx.clearRect(0, 0, 64, 64);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, 64, 64, 14);
    ctx.clip();
    const s = Math.max(64 / this.img.width, 64 / this.img.height);
    // YouTube thumbnails are 16:9 with the cover in the middle, so crop to the centre square
    ctx.drawImage(this.img, (64 - this.img.width * s) / 2, (64 - this.img.height * s) / 2, this.img.width * s, this.img.height * s);
    const g = ctx.createLinearGradient(0, 18, 0, 64);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.restore();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const h = this.playing ? 8 + Math.abs(Math.sin(this.t * (1.3 + i * 0.37) + i * 1.7)) * 22 : 6;
      ctx.beginPath();
      ctx.roundRect(14 + i * 10, 56 - h, 6, h, 3);
      ctx.fill();
    }
    this.link.href = this.c.toDataURL('image/png');
  }
}
