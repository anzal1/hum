// The embeddable hum player. Same engine as the full app, sized for a corner of
// someone else's app, and controllable from the host page with postMessage.
import { Engine, api, fmt, sized, spotifyLink, youtubeId, connectRemote } from './engine.js';
import { Aurora } from './aurora.js';
import { palette } from './palette.js';
import { fetchLyrics } from './lyrics.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const engine = new Engine($('#yt'));
const aurora = new Aurora($('#aurora'));
const params = new URLSearchParams(location.search);
const host = window.parent !== window ? window.parent : null;
// ?card=1 is the compact card the MCP server shows inside a chat (see mcp.js).
const card = params.get('card') === '1';
if (card) {
  body.classList.add('card');
  $('.w-idle p').textContent = 'Warming up the music';
  $('.w-title').textContent = 'hum';
  $('.w-artist').textContent = 'Ready when you are';
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MOODS = [
  ['Lo-fi focus', 'Aruarian Dance Nujabes'],
  ['Deep work', 'Weightless Marconi Union'],
  ['Midnight drive', 'Blinding Lights The Weeknd'],
  ['Bollywood', 'Kesariya Arijit Singh'],
  ['Punjabi', 'Brown Munde AP Dhillon'],
  ['Rainy', 'Apocalypse Cigarettes After Sex'],
  ['Hype', 'Till I Collapse Eminem'],
];

$('.w-moods').innerHTML = MOODS.map(([name], i) => `<button data-mood="${i}">${name}</button>`).join('');
$('[data-w=prev]').innerHTML = icon('prev');
$('[data-w=next]').innerHTML = icon('next');

// Google's image CDN rate-limits bursts. A cover that fails falls back to YouTube's thumbnail.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fb && img.src !== img.dataset.fb) img.src = img.dataset.fb;
  },
  true,
);

// ---------- painting ----------

let lines = [];
let lineIdx = -1;
if (card) engine.lyricLines = () => lines; // the chat reads the sung line from snapshots
engine.addEventListener('track', ({ detail: t }) => {
  body.classList.add('has-track');
  $('.w-title').textContent = t.title;
  $('.w-artist').textContent = t.artist;
  $('.w-line').textContent = '';
  lines = [];
  lineIdx = -1;
  const token = engine.token;
  fetchLyrics(t).then((d) => token === engine.token && (lines = d?.synced || []));
  if (t.art)
    palette(sized(t.art, 120))
      .then((p) => p || (t.id ? palette(`https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`) : null))
      .then((p) => {
      if (!p || engine.current !== t) return;
      aurora.setColors(p.colors);
      document.documentElement.style.setProperty('--accent', p.accent.join(' '));
    });
  tell();
});
engine.addEventListener('playing', ({ detail: on }) => {
  body.classList.toggle('playing', on);
  if (on) $('.w-tap').hidden = true;
  aurora.setPlaying(on);
  paintPlay();
  tell();
});
engine.addEventListener('blocked', () => ($('.w-tap').hidden = false));
engine.addEventListener('notice', ({ detail }) => flash(detail));
engine.addEventListener('queue', tell);

const paintPlay = () => ($('[data-w=toggle]').innerHTML = icon(engine.playing ? 'pause' : 'play'));
paintPlay();

function flash(text) {
  $('.w-line').textContent = text;
  $('.w-line').classList.add('note');
  setTimeout(() => $('.w-line').classList.remove('note'), 2500);
}

let lastSec = -1;
function tick() {
  requestAnimationFrame(tick);
  if (!engine.current || document.hidden) return;
  const cur = engine.time, dur = engine.duration;
  $('.w-fill').style.transform = `scaleX(${dur ? Math.min(1, cur / dur) : 0})`;
  const sec = Math.floor(cur);
  if (sec !== lastSec) {
    lastSec = sec;
    $('.w-time').textContent = `${fmt(cur)} / ${fmt(dur)}`;
  }
  if (lines.length) {
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= cur + 0.15; k++) i = k;
    if (i !== lineIdx) {
      lineIdx = i;
      const el = $('.w-line');
      el.classList.remove('in');
      void el.offsetWidth;
      el.textContent = i >= 0 ? lines[i].text || '♪' : '';
      el.classList.add('in');
      aurora.kick(0.25);
    }
  }
}
requestAnimationFrame(tick);

$('.w-bar').addEventListener('pointerdown', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  engine.seek(((e.clientX - r.left) / r.width) * engine.duration);
});

// ---------- search ----------

const input = $('#wq');
let results = [];
let searchToken = 0;
const closeResults = () => {
  $('.w-results').hidden = true;
  body.classList.remove('searching');
};
input.addEventListener('focus', () => engine.warm(), { once: true });
input.addEventListener('input', debounce(async () => {
  const q = input.value.trim();
  if (!q) return closeResults();
  if (spotifyLink(q) || youtubeId(q)) return;
  const token = ++searchToken;
  try {
    results = await api('search', { q, limit: 8 });
  } catch {
    results = [];
  }
  if (token !== searchToken) return;
  $('.w-results').innerHTML = results.length
    ? results
        .map(
          (t, i) => `<button class="w-row" data-r="${i}"><img src="${esc(sized(t.art, 96))}" data-fb="https://i.ytimg.com/vi/${t.id}/mqdefault.jpg" alt="" loading="lazy" decoding="async"><span><b>${esc(t.title)}</b><i>${esc(t.artist)}</i></span></button>`,
        )
        .join('')
    : '<p class="w-none">Nothing found</p>';
  $('.w-results').hidden = false;
  body.classList.add('searching');
}, 160));
input.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    input.value = '';
    closeResults();
    input.blur();
  }
  if (e.key !== 'Enter') return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  closeResults();
  input.blur();
  if (spotifyLink(q)) return run({ cmd: 'playlist', url: q });
  if (youtubeId(q)) return engine.playYouTube(youtubeId(q));
  if (results[0]) return engine.playList([{ ...results[0] }], 0, { name: q, href: '#/' }, { keepOrder: true });
  run({ cmd: 'play', query: q });
});
input.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  if (spotifyLink(text)) {
    e.preventDefault();
    run({ cmd: 'playlist', url: text });
  }
});

// ---------- clicks ----------

document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-r]');
  if (r) {
    engine.playList([{ ...results[r.dataset.r] }], 0, { name: input.value, href: '#/' }, { keepOrder: true });
    input.value = '';
    return closeResults();
  }
  const mood = e.target.closest('[data-mood]');
  if (mood) {
    const [name, seed] = MOODS[mood.dataset.mood];
    flash(`Tuning into ${name}`);
    return run({ cmd: 'station', mood: seed, name });
  }
  const w = e.target.closest('[data-w]')?.dataset.w;
  if (w === 'toggle') return engine.current ? engine.toggle() : $('[data-mood="0"]').click();
  if (w === 'next') return engine.next();
  if (w === 'prev') return engine.prev();
  if (w === 'hide') return host?.postMessage({ hum: 'hide' }, '*');
  if (w === 'tap') {
    $('.w-tap').hidden = true;
    return engine.play();
  }
  if (!e.target.closest('.w-results, .w-search')) closeResults();
});

addEventListener('keydown', (e) => {
  if (e.target === input) return;
  if (e.key === ' ') (e.preventDefault(), engine.toggle());
  if (e.key === '/') (e.preventDefault(), input.focus());
});

// ---------- host page and agents ----------

async function run(msg) {
  try {
    return { ok: true, text: await engine.command(msg) };
  } catch (err) {
    flash(err.message);
    return { ok: false, text: err.message };
  }
}

function tell() {
  host?.postMessage({ hum: 'state', ...engine.snapshot() }, '*');
}

// The host page drives the player with window.hum (see embed.js), which posts here.
addEventListener('message', async (e) => {
  if (e.source !== host || !e.data || typeof e.data.hum !== 'string' || ['state', 'ready', 'reply'].includes(e.data.hum)) return;
  const msg = { ...e.data, cmd: e.data.hum };
  if (msg.cmd === 'snapshot') return host.postMessage({ hum: 'reply', id: msg.id, ok: true, state: engine.snapshot() }, '*');
  const reply = await run(msg);
  host.postMessage({ hum: 'reply', id: msg.id, ...reply }, '*');
});

if (!card) connectRemote(engine);
window.requestIdleCallback ? requestIdleCallback(() => engine.warm(), { timeout: 1500 }) : setTimeout(() => engine.warm(), 1500);

// Start from URL params: ?station=lofi, ?q=song, ?playlist=<spotify link>, &autoplay=1
const autoplay = params.get('autoplay') === '1';
if (params.get('hideable') && host) $('.w-hide').hidden = false;
if (params.get('accent')) document.documentElement.style.setProperty('--accent', params.get('accent'));
if (params.get('station')) engine.station(params.get('station'), params.get('station'), { autoplay }).catch(() => {});
else if (params.get('q')) engine.playQuery(params.get('q'), null, { autoplay }).catch(() => {});
else if (params.get('playlist'))
  engine.importPlaylist(params.get('playlist')).then((pl) => engine.playList(pl.tracks, 0, { name: pl.name, href: '#/' }, { autoplay })).catch(() => {});
host?.postMessage({ hum: 'ready' }, '*');

function debounce(fn, ms) {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
}
