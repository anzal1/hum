// A slow, domain-warped light field painted in the current song's colours.
const FRAG = `
precision highp float;
uniform vec2 r; uniform float t; uniform float e;
uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 c4;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*n(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5*r) / min(r.x, r.y);
  float T = t * 0.035;
  vec2 q = vec2(fbm(p*1.1 + vec2(0.0, T)), fbm(p*1.1 + vec2(5.2, -T)));
  vec2 w = vec2(fbm(p*1.4 + 2.2*q + vec2(1.7, 9.2) + T*1.4), fbm(p*1.4 + 2.2*q + vec2(8.3, 2.8) - T));
  float f = fbm(p*1.2 + 2.6*w);
  vec3 col = mix(c4, c1, smoothstep(0.15, 0.75, f));
  col = mix(col, c2, smoothstep(0.35, 0.95, length(w) * 0.85));
  col = mix(col, c3, smoothstep(0.5, 1.0, q.y) * 0.7);
  col += c1 * pow(max(0.0, 1.0 - length(p - vec2(-0.55, 0.45))), 3.0) * 0.35;
  float v = smoothstep(1.35, 0.15, length(p * vec2(0.75, 1.0)));
  col *= (0.28 + 0.72 * v) * (0.62 + 0.38 * e);
  gl_FragColor = vec4(col, 1.0);
}`;
const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

export class Aurora {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    this.cur = [[120, 52, 170], [40, 74, 170], [190, 92, 70], [16, 11, 28]].map((c) => c.map((v) => v / 255));
    this.target = this.cur.map((c) => [...c]);
    this.energy = 0.55;
    this.pulse = 0;
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.gl) return canvas.classList.add('off');
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['r', 't', 'e', 'c1', 'c2', 'c3', 'c4'].map((k) => [k, gl.getUniformLocation(prog, k)]));
    this.start = performance.now() - Math.random() * 1e5;
    addEventListener('resize', () => this.resize());
    this.resize();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  resize() {
    const s = innerWidth > 1600 ? 0.28 : 0.36; // painted soft anyway, so a fraction of the pixels is plenty
    this.canvas.width = Math.max(2, Math.round(innerWidth * s));
    this.canvas.height = Math.max(2, Math.round(innerHeight * s));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  setColors(colors) {
    this.target = colors.slice(0, 4).map((c) => c.map((v) => v / 255));
  }
  kick(amount = 0.35) {
    this.pulse = Math.min(1, this.pulse + amount);
  }
  setPlaying(on) {
    this.playing = on;
  }
  frame(now) {
    requestAnimationFrame(this.frame);
    // The field drifts slowly, 30 frames a second is plenty and halves the GPU work.
    if (document.hidden || now - (this.lastDraw || 0) < 32) return;
    this.lastDraw = now;
    const gl = this.gl;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) this.cur[i][j] += (this.target[i][j] - this.cur[i][j]) * 0.05;
    this.pulse *= 0.92;
    const base = this.playing ? 0.82 : 0.6;
    this.energy += (base + this.pulse * 0.4 - this.energy) * 0.1;
    const t = this.still ? 40 : (now - this.start) / 1000 * (this.playing ? 1.6 : 1);
    gl.uniform2f(this.u.r, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.t, t);
    gl.uniform1f(this.u.e, this.energy);
    ['c1', 'c2', 'c3', 'c4'].forEach((k, i) => gl.uniform3fv(this.u[k], this.cur[i]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
