// The notch island. It mirrors whatever hum window is playing, over a
// BroadcastChannel, and sends button presses back. In the desktop app it lives
// in a transparent always-on-top window over the Mac notch or the top of the screen.
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const desk = window.humDesktop; // only present inside the desktop app
const bridge = new BroadcastChannel('hum-bridge');
const n = $('#n');
const body = document.body;
let state = null;
let lastSeen = 0;

if (params.get('notch') === '1') body.classList.add('has-notch');
if (params.get('menu')) document.documentElement.style.setProperty('--menu', `${params.get('menu')}px`);
if (params.get('width')) document.documentElement.style.setProperty('--notch', `${params.get('width')}px`);

$('[data-cmd="prev"]').innerHTML = icon('prev');
$('[data-cmd="next"]').innerHTML = icon('next');
$('[data-cmd="show"]').innerHTML = icon('expand');

const fmt = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const send = (cmd, extra = {}) => bridge.postMessage({ type: 'cmd', cmd, ...extra });

function paint() {
  const s = state;
  body.classList.toggle('idle', !s?.track);
  body.classList.toggle('playing', !!s?.playing);
  $('[data-cmd="toggle"]').innerHTML = icon(s?.playing ? 'pause' : 'play');
  if (!s?.track) return;
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  (s.palette || []).forEach((c, i) => c && document.documentElement.style.setProperty(`--p${i + 1}`, c));
  if (s.line && s.line !== paint.lastLine && !n.classList.contains('open')) {
    n.classList.add('bump');
    setTimeout(() => n.classList.remove('bump'), 280);
  }
  paint.lastLine = s.line;
  // Google's image server rate-limits bursts; fall back to YouTube's thumbnail.
  for (const img of [$('.art'), $('.big')]) {
    img.onerror = () => s.artFallback && img.src !== s.artFallback && (img.src = s.artFallback);
    if (s.art && img.dataset.want !== s.art) (img.dataset.want = s.art), (img.src = s.art);
  }
  $('.title').textContent = s.track.title;
  $('.artist').textContent = s.track.artist;
  const line = s.line || `${s.track.title} · ${s.track.artist}`;
  $('.line').textContent = line;
  $('.lyric').textContent = s.line || '';
  $('[data-cmd="like"]').innerHTML = icon(s.liked ? 'heartFill' : 'heart');
  $('[data-cmd="like"]').classList.toggle('on', !!s.liked);
  // the floating pill grows to fit the line
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:600 13px Geist,system-ui';
  probe.textContent = line;
  document.body.append(probe);
  document.documentElement.style.setProperty('--pill', `${Math.max(180, Math.min(probe.offsetWidth + 82, 380))}px`);
  probe.remove();
}

bridge.onmessage = ({ data }) => {
  if (data?.type !== 'state') return;
  state = data;
  lastSeen = Date.now();
  paint();
};
send('hello');
setInterval(() => {
  if (Date.now() - lastSeen > 12000 && state) (state = null), paint();
  if (!state) send('hello');
}, 3000);

// Smooth progress between state messages.
function tick() {
  requestAnimationFrame(tick);
  if (!state?.track) return;
  const pos = Math.min(state.duration || 0, state.position + (state.playing ? (Date.now() - state.at) / 1000 : 0));
  $('.fill').style.transform = `scaleX(${state.duration ? pos / state.duration : 0})`;
  $('.cur').textContent = fmt(pos);
  $('.dur').textContent = fmt(state.duration);
}
requestAnimationFrame(tick);

// Hover opens it. The desktop window ignores the mouse except over the island,
// so the menu bar and desktop under the transparent area keep working.
let t;
n.addEventListener('mouseenter', () => {
  clearTimeout(t);
  desk?.interactive(true);
  t = setTimeout(() => n.classList.add('open'), 90);
});
n.addEventListener('mouseleave', () => {
  clearTimeout(t);
  t = setTimeout(() => {
    n.classList.remove('open');
    desk?.interactive(false);
  }, 320);
});

document.addEventListener('click', (e) => {
  const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
  if (!cmd) return;
  if (cmd === 'show') return desk ? desk.showMain() : send('open');
  send(cmd);
});
$('.track').addEventListener('pointerdown', (e) => {
  if (!state?.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  send('seek', { seconds: ((e.clientX - r.left) / r.width) * state.duration });
});
