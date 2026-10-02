import { Engine, api, store, keyOf, fmt, sized, spotifyLink, youtubeId, connectRemote } from './engine.js';
import { Aurora } from './aurora.js';
import { palette } from './palette.js';
import { fetchLyrics, LyricsView, escapeHtml as esc } from './lyrics.js';
import { icon } from './icons.js';
import { genArt, likedArt, stationArt, paintArt, initArtMotion, Favicon } from './art.js';
import { initImages, initTilt, initPeek } from './fx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const body = document.body;
const view = $('#view');
const input = $('#q');
const debounce = (fn, ms) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = message;
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, 2600);
}

// ---------- library ----------

const lib = {
  liked: store.get('liked', []),
  recent: store.get('recent', []),
  playlists: store.get('playlists', []),
};
const saveLib = debounce(() => {
  store.set('liked', lib.liked);
  store.set('recent', lib.recent);
  store.set('playlists', lib.playlists);
}, 300);
const slim = ({ id, title, artist, album, duration, art }) => ({ id, title, artist, album, duration, art });
const isLiked = (t) => !!t && lib.liked.some((x) => keyOf(x) === keyOf(t));
function toggleLike(t) {
  if (!t) return;
  if (isLiked(t)) {
    lib.liked = lib.liked.filter((x) => keyOf(x) !== keyOf(t));
    toast('Removed from Liked');
  } else {
    lib.liked.unshift(slim(t));
    toast(`${icon('heartFill', 'tiny')} Saved to Liked`);
  }
  saveLib();
  paintLikes();
}

// ---------- engine and surfaces ----------

const engine = new Engine($('#yt'), { onResolve: saveLib });
const current = () => engine.current;
const aurora = new Aurora($('#aurora'));
const favicon = new Favicon();
const lyrics = new LyricsView($('#lyrics'), {
  onSeek: (t) => engine.seek(t),
  onLine: () => aurora.kick(0.3),
});

engine.addEventListener('track', ({ detail }) => showTrack(detail));
engine.addEventListener('started', ({ detail }) => remember(detail));
engine.addEventListener('playing', ({ detail }) => setPlaying(detail));
engine.addEventListener('queue', () => renderQueue());
engine.addEventListener('modes', () => paintModes());
engine.addEventListener('notice', ({ detail }) => toast(esc(detail)));
engine.addEventListener('blocked', () => body.classList.add('needs-tap'));
connectRemote(engine);

// Start loading YouTube the moment someone shows intent, not on page load.
const warm = () => engine.warm();
input.addEventListener('focus', warm, { once: true });
addEventListener('pointerdown', warm, { once: true });
window.requestIdleCallback ? requestIdleCallback(warm, { timeout: 2500 }) : setTimeout(warm, 2500);

// Google's image CDN rate-limits bursts. A cover that fails falls back to YouTube's thumbnail.
const fb = (t) => (t.id ? ` data-fb="https://i.ytimg.com/vi/${t.id}/mqdefault.jpg"` : '');
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fb && img.src !== img.dataset.fb) img.src = img.dataset.fb;
  },
  true,
);

function remember(t) {
  lib.recent = [slim(t), ...lib.recent.filter((x) => keyOf(x) !== keyOf(t))].slice(0, 30);
  saveLib();
}

// Cache the nodes we touch on every frame or every track.
const els = {
  title: $$('.js-title'),
  artist: $$('.js-artist'),
  art: $$('.js-art'),
  play: $$('.js-play'),
  like: $$('.js-like'),
  fill: $$('.js-fill'),
  cur: $$('.js-cur'),
  dur: $$('.js-dur'),
  shuffle: $$('.js-shuffle'),
  repeat: $$('.js-repeat'),
  volume: $$('.js-volume'),
  mute: $$('.js-mute'),
};

function setPlaying(on) {
  body.classList.toggle('playing', on);
  placeStage();
  if (on) body.classList.remove('needs-tap');
  aurora.setPlaying(on);
  favicon.setPlaying(on);
  els.play.forEach((b) => {
    b.innerHTML = icon(on ? 'pause' : 'play');
    b.setAttribute('aria-label', on ? 'Pause' : 'Play');
  });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
}

let shownKey = null;
function showTrack(t) {
  const sub = [t.artist, t.album && t.album !== t.title ? t.album : ''].filter(Boolean).join(' · ');
  els.title.forEach((el) => (el.textContent = t.title));
  els.artist.forEach((el) => (el.textContent = sub));
  if (t.art)
    els.art.forEach((el) => {
      if (t.id) el.dataset.fb = `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`;
      el.src = sized(t.art, 120);
    });
  $('#np-ctx').textContent = engine.ctx.name;
  $('#np-ctx').href = engine.ctx.href;
  $('#dock').classList.remove('off');
  body.classList.add('has-track');
  document.title = `${t.title} · ${t.artist}`;
  paintLikes();
  paintModes();
  renderQueue();
  markPlayingRows();
  placeStage();
  const k = keyOf(t);
  if (k !== shownKey) {
    shownKey = k;
    favicon.setTrack(t);
    lyrics.state('loading', '<span class="loader"></span>');
    const token = engine.token;
    fetchLyrics(t).then((d) => token === engine.token && lyrics.set(d));
  }
  if (t.art) {
    palette(sized(t.art, 120))
      .then((p) => p || (t.id ? palette(`https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`) : null))
      .then((p) => {
      if (!p || current() !== t) return;
      aurora.setColors(p.colors);
      const root = document.documentElement.style;
      root.setProperty('--accent', p.accent.join(' '));
      [p.accent, ...p.colors.slice(0, 3)].forEach((c, i) => root.setProperty(`--p${i + 1}`, c.join(' ')));
    });
  }
  if ('mediaSession' in navigator && t.title) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album || '',
      artwork: t.art ? [{ src: sized(t.art, 512), sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  }
}

function paintLikes() {
  const on = isLiked(current());
  els.like.forEach((b) => {
    b.innerHTML = icon(on ? 'heartFill' : 'heart');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  const liked = new Set(lib.liked.map(keyOf));
  $$('#view [data-like-key]').forEach((b) => {
    const t = liked.has(b.dataset.likeKey);
    if (b.classList.contains('on') === t && b.firstChild) return;
    b.innerHTML = icon(t ? 'heartFill' : 'heart');
    b.classList.toggle('on', t);
  });
}
function paintModes() {
  els.shuffle.forEach((b) => b.classList.toggle('on', engine.shuffle));
  els.repeat.forEach((b) => {
    b.classList.toggle('on', engine.repeat !== 'off');
    b.innerHTML = icon(engine.repeat === 'one' ? 'repeat1' : 'repeat');
  });
  els.volume.forEach((r) => {
    r.value = engine.volume;
    r.style.setProperty('--v', engine.volume);
  });
  els.mute.forEach((b) => (b.innerHTML = icon(engine.volume > 0 ? 'volume' : 'mute')));
}

let npOpen = false;
function openNP(tab) {
  if (!current()) return;
  if (tab) setTab(tab);
  npOpen = true;
  body.classList.add('np-open');
  $('#np').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(moveInk);
  if (renderQueue.stale) renderQueue();
  placeStage();
  requestAnimationFrame(() => lyrics.follow(true));
}
function closeNP() {
  npOpen = false;
  body.classList.remove('np-open');
  $('#np').setAttribute('aria-hidden', 'true');
  placeStage();
}
// The white pill under the tabs is sized from the real button, so any font or language fits.
function moveInk() {
  const on = $('.tabs button.on'), ink = $('.tab-ink');
  if (!on || !on.offsetWidth) return;
  ink.style.width = `${on.offsetWidth}px`;
  ink.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}
document.fonts?.ready.then(moveInk);
addEventListener('resize', moveInk);

function setTab(name) {
  $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('.tabs').dataset.on = name;
  moveInk();
  $('#lyrics').hidden = name !== 'lyrics';
  $('#queue').hidden = name !== 'queue';
  if (name === 'lyrics') requestAnimationFrame(() => lyrics.follow(true));
}

// The YouTube player is one iframe that never moves in the DOM (moving it would
// reload it). It glides between the big slot and the floating corner window.
// On wide screens the player lives in a side panel the page makes room for.
// Anywhere else it floats, and tucks away whenever nothing is playing, because
// YouTube only requires it to be visible while it plays.
const stage = $('#stage');
const side = $('#side');
body.classList.toggle('side-off', store.get('sideOff', false));
const sideVisible = () => !!current() && getComputedStyle(side).display !== 'none';
let lastRect = null;
let tuckTimer;
function placeStage() {
  sideOn = sideVisible();
  const on = !!current();
  stage.classList.toggle('off', !on);
  if (!on) return;
  const slot = npOpen ? '#np-slot' : sideVisible() ? '#side-slot' : '#pip-slot';
  const floating = slot === '#pip-slot';
  stage.classList.toggle('pip', floating);
  clearTimeout(tuckTimer);
  if (!floating || engine.playing) stage.classList.remove('tucked');
  else
    tuckTimer = setTimeout(() => {
      if (engine.playing) return;
      stage.classList.add('tucked');
      body.classList.remove('pip-on');
    }, 1500);
  body.classList.toggle('pip-on', floating && !stage.classList.contains('tucked'));
  const r = $(slot).getBoundingClientRect();
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const geometry = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
  if (lastRect && (lastRect.width !== rect.width || lastRect.left !== rect.left || lastRect.top !== rect.top)) {
    stage.style.transition = 'none';
    stage.style.transform = `translate(${lastRect.left - rect.left}px, ${lastRect.top - rect.top}px) scale(${lastRect.width / rect.width}, ${lastRect.height / rect.height})`;
    Object.assign(stage.style, geometry);
    stage.getBoundingClientRect();
    stage.style.transition = '';
    stage.style.transform = '';
  } else Object.assign(stage.style, geometry);
  lastRect = rect;
}
addEventListener('resize', debounce(() => {
  lastRect = null;
  placeStage();
}, 60));

// ---------- progress, seeking, time loop ----------

let dragging = null;
const last = { ratio: -1, sec: -1, dur: -1 };
function tick() {
  requestAnimationFrame(tick);
  const t = current();
  if (!t || document.hidden) return;
  const dur = engine.duration;
  const cur = dragging ? dragging.ratio * dur : engine.time;
  const ratio = dur ? Math.min(1, cur / dur) : 0;
  if (Math.abs(ratio - last.ratio) > 0.0005) {
    last.ratio = ratio;
    els.fill.forEach((el) => (el.style.transform = `scaleX(${ratio})`));
  }
  const sec = Math.floor(cur);
  if (sec !== last.sec || dur !== last.dur) {
    last.sec = sec;
    last.dur = dur;
    els.cur.forEach((el) => (el.textContent = fmt(cur)));
    els.dur.forEach((el) => (el.textContent = fmt(dur)));
  }
  if (!dragging && npOpen) lyrics.update(cur);
  else if (!npOpen && sideOn) sideLine(cur);
  if (!npOpen && body.classList.contains('notch')) islandLine(cur);
}
let sideOn = false;
let sideIdx = -2;
function sideLine(time) {
  const lines = lyrics.lines;
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= time + 0.15; k++) i = k;
  if (!lines.length) i = -2;
  if (i === sideIdx) return;
  sideIdx = i;
  const el = $('.side-line');
  el.classList.remove('in');
  void el.offsetWidth;
  el.textContent = i >= 0 ? lines[i].text || '♪' : '';
  el.classList.add('in');
}
requestAnimationFrame(tick);

$$('.bar').forEach((bar) => {
  const ratioAt = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!current()) return;
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {}
    dragging = { ratio: ratioAt(e) };
    bar.classList.add('drag');
  });
  bar.addEventListener('pointermove', (e) => dragging && (dragging.ratio = ratioAt(e)));
  bar.addEventListener('pointerup', () => {
    if (!dragging) return;
    engine.seek(dragging.ratio * engine.duration);
    dragging = null;
    bar.classList.remove('drag');
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') engine.seek(engine.time + 5);
    if (e.key === 'ArrowLeft') engine.seek(engine.time - 5);
  });
});
els.volume.forEach((r) => r.addEventListener('input', () => engine.setVolume(Number(r.value))));

// ---------- queue panel ----------

function renderSide() {
  const t = current();
  const next = t ? engine.list.slice(engine.i + 1, engine.i + 5) : [];
  $('#side-queue').innerHTML = next.length ? next.map((x, k) => qRow(x, engine.i + 1 + k)).join('') : '<p class="q-empty">Autoplay will find something good.</p>';
}
$('#side-queue').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-q-remove]');
  if (rm) return engine.remove(Number(rm.dataset.qRemove));
  const row = e.target.closest('[data-q]');
  if (row) engine.jump(Number(row.dataset.q));
});

function renderQueue() {
  renderSide();
  const el = $('#queue');
  const t = current();
  if (!t) return (el.innerHTML = '');
  if (!npOpen || el.hidden) return (renderQueue.stale = true);
  renderQueue.stale = false;
  const upcoming = engine.list.slice(engine.i + 1, engine.i + 61);
  const firstRadio = upcoming.findIndex((x) => x.radio);
  el.innerHTML = `
    <div class="q-label">Now playing</div>
    ${qRow(t, engine.i, true)}
    ${upcoming.length ? '<div class="q-label">Next up</div>' : ''}
    ${upcoming
      .map((x, k) => (k === firstRadio ? `<div class="q-label spark">${icon('spark', 'tiny')} Autoplay keeps the mood going</div>` : '') + qRow(x, engine.i + 1 + k))
      .join('')}
    ${upcoming.length ? '' : '<p class="q-empty">Nothing queued. Autoplay will find something good.</p>'}`;
}
const qRow = (t, i, now) => `
  <div class="q-row ${now ? 'now' : ''}" data-q="${i}">
    <div class="q-art">${t.art ? `<img src="${esc(sized(t.art, 96))}"${fb(t)} alt="" loading="lazy" decoding="async">` : ''}${now ? eq() : ''}</div>
    <div class="q-text"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>
    ${now ? '' : `<button class="icon-btn small" data-q-remove="${i}" aria-label="Remove from queue">${icon('x')}</button>`}
  </div>`;
const eq = () => '<span class="eq"><i></i><i></i><i></i><i></i></span>';

$('#queue').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-q-remove]');
  if (rm) return engine.remove(Number(rm.dataset.qRemove));
  const row = e.target.closest('[data-q]');
  if (row) engine.jump(Number(row.dataset.q));
});

// ---------- views ----------

const STATIONS = [
  { name: 'Midnight Drive', seed: 'Blinding Lights The Weeknd', note: 'Neon, synths, empty roads', c: ['#ff3d6e', '#5b2bd9', '#0d0b26'] },
  { name: 'Lo-fi Focus', seed: 'Aruarian Dance Nujabes', note: 'Soft beats to get lost in', c: ['#7ee0d6', '#3d7ea6', '#0d2230'] },
  { name: 'Bollywood Heartbreak', seed: 'Channa Mereya Arijit Singh', note: 'For the ones that got away', c: ['#ff8a5b', '#a23bd6', '#1c0a24'] },
  { name: 'Punjabi Hype', seed: 'Brown Munde AP Dhillon', note: 'Windows down, volume up', c: ['#ffc23d', '#ff5a1f', '#2a0c00'] },
  { name: 'Sunday Morning', seed: 'Here Comes The Sun The Beatles', note: 'Coffee, sunlight, no plans', c: ['#ffd98a', '#f08a5d', '#5a3d5c'] },
  { name: 'Rainy Window', seed: 'Apocalypse Cigarettes After Sex', note: 'Slow, hazy, beautiful', c: ['#a7b4c9', '#4a5578', '#0b0d16'] },
  { name: 'Gym Rage', seed: 'Till I Collapse Eminem', note: 'One more rep', c: ['#ff3b3b', '#b3001b', '#160003'] },
  { name: 'Old Souls', seed: 'Afreen Afreen Nusrat Fateh Ali Khan', note: 'Qawwali, ghazal, forever', c: ['#e9c46a', '#a0643a', '#24170e'] },
];

// Hovering a station fetches its mix, so the click plays instantly.
function prefetchStation(s) {
  warm();
  api('search', { q: s.seed, limit: 1 })
    .then(([hit]) => hit && api('radio', { id: hit.id }))
    .catch(() => {});
}
async function startStation(s) {
  toast(`${icon('spark', 'tiny')} Tuning into <b>${esc(s.name)}</b>`);
  try {
    await engine.station(s.seed, s.name);
  } catch (e) {
    toast(esc(e.message), 'err');
  }
}

function cover(pl, px = 360) {
  if (pl.cover) return `<img src="${esc(pl.cover)}" alt="" loading="lazy" decoding="async">`;
  const arts = pl.tracks.map((t) => t.art).filter(Boolean).slice(0, 4);
  if (arts.length === 4) return `<div class="mosaic">${arts.map((a) => `<img src="${esc(sized(a, px / 2))}" alt="" loading="lazy" decoding="async">`).join('')}</div>`;
  return genArt(pl.id || pl.name, { label: pl.name });
}

function renderHome() {
  const recent = lib.recent.slice(0, 12);
  view.innerHTML = `
    <section class="shelf">
      <div class="shelf-head"><h3>Start a station</h3><span>One tap. Endless music in that mood.</span></div>
      <div class="stations">
        ${STATIONS.map(
          (s, i) => `
          <button class="station" data-station="${i}" style="--c1:${s.c[0]};--c2:${s.c[1]};--c3:${s.c[2]};--i:${i}">
            ${stationArt(s.name, s.c)}
            <span class="shine"></span>
            <span class="station-name">${s.name}</span>
            <span class="station-note">${s.note}</span>
            <span class="station-play">${icon('play')}</span>
          </button>`,
        ).join('')}
      </div>
    </section>
    ${
      recent.length
        ? `<section class="shelf">
        <div class="shelf-head"><h3>Jump back in</h3></div>
        <div class="row-scroll">${recent
          .map(
            (t, i) => `
          <button class="tile" data-recent="${i}" style="--i:${i}">
            <span class="tile-art"><img src="${esc(sized(t.art, 360))}"${fb(t)} alt="" loading="lazy" decoding="async"><span class="tile-play">${icon('play')}</span><span class="shine"></span></span>
            <b>${esc(t.title)}</b><span>${esc(t.artist)}</span>
          </button>`,
          )
          .join('')}</div>
      </section>`
        : ''
    }
    <section class="shelf">
      <div class="shelf-head"><h3>Your library</h3></div>
      <div class="library">
        <a class="pl-card liked-card" href="#/liked">
          <span class="pl-cover">${likedArt(icon('heartFill'))}<span class="shine"></span></span>
          <b>Liked songs</b><span>${lib.liked.length} ${lib.liked.length === 1 ? 'song' : 'songs'}</span>
        </a>
        ${lib.playlists
          .map(
            (p) => `
          <a class="pl-card" href="#/pl/${encodeURIComponent(p.id)}">
            <span class="pl-cover">${cover(p)}<span class="shine"></span></span>
            <b>${esc(p.name)}</b><span>${p.tracks.length} songs${p.source === 'spotify' ? ' · from Spotify' : ''}</span>
          </a>`,
          )
          .join('')}
        <button class="pl-card import-card" data-act="import-help">
          <span class="pl-cover"><div class="import-cover">${icon('plus')}</div></span>
          <b>Bring a playlist</b><span>Paste any Spotify link</span>
        </button>
      </div>
    </section>
    <footer class="foot">Playback runs through YouTube's official player, so artists still get paid. <a href="developers.html">For developers</a></footer>`;
}

// ---------- search ----------

let searchToken = 0;
let results = [];
let selected = 0;

async function runSearch(text) {
  const query = text.trim();
  if (!query) return route();
  if (spotifyLink(query)) return importSpotify(query);
  const yid = youtubeId(query);
  if (yid) return playYouTube(yid);
  const token = ++searchToken;
  const job = api('search', { q: query, limit: 24 });
  const slow = setTimeout(() => token === searchToken && (view.innerHTML = skeleton()), 120);
  try {
    const data = await job;
    clearTimeout(slow);
    if (token !== searchToken) return;
    results = data;
    selected = 0;
    renderResults(query);
  } catch (e) {
    clearTimeout(slow);
    if (token === searchToken) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderResults(query) {
  if (!results.length) {
    view.innerHTML = `<div class="empty">Nothing for <b>${esc(query)}</b>.<br><span>Try the artist's name too.</span></div>`;
    return;
  }
  const [top, ...rest] = results;
  view.innerHTML = `
    <div class="results">
      <section class="top-result">
        <div class="shelf-head"><h3>Top result</h3></div>
        <div class="top-card" data-play="0" data-key="${esc(keyOf(top))}" role="button" tabindex="0" aria-label="Play ${esc(top.title)}">
          <span class="top-bg" style="background-image:url('${esc(sized(top.art, 120))}')"></span>
          <span class="top-art"><img src="${esc(sized(top.art, 360))}"${fb(top)} alt="" decoding="async"></span>
          <span class="top-info">
            <span class="top-kind">Song${top.duration ? ` · ${fmt(top.duration)}` : ''}</span>
            <span class="top-title">${esc(top.title)}</span>
            <span class="top-sub">${esc(top.artist)}${top.album && top.album !== top.title ? ` · ${esc(top.album)}` : ''}</span>
            <span class="top-actions">
              <span class="top-go">${icon('play')} Play</span>
              <button class="icon-btn small" data-row-queue="0" aria-label="Play next" title="Play next">${icon('plus')}</button>
              <button class="icon-btn small" data-like-key="${esc(keyOf(top))}" data-row-like="0" aria-label="Like" title="Like">${icon('heart')}</button>
            </span>
          </span>
          <span class="shine"></span>
        </div>
      </section>
      <section class="songs">
        <div class="shelf-head"><h3>Songs</h3><span>Enter to play · ↑↓ to choose</span></div>
        <div class="rows">${rest.slice(0, 8).map((t, k) => row(t, k + 1)).join('')}</div>
      </section>
    </div>
    ${rest.length > 8 ? `<section class="shelf"><div class="rows">${rest.slice(8).map((t, k) => row(t, k + 9)).join('')}</div></section>` : ''}`;
  markSelected();
  markPlayingRows();
  paintLikes();
}

const row = (t, i, n) => `
  <div class="row" data-play="${i}" data-key="${esc(keyOf(t))}" style="--i:${Math.min(i, 12)}">
    ${n ? `<span class="n">${n}</span>` : ''}
    <span class="row-art">${t.art ? `<img src="${esc(sized(t.art, 96))}"${fb(t)} alt="" loading="lazy" decoding="async">` : '<span class="shimmer"></span>'}<span class="row-play">${icon('play')}</span>${eq()}</span>
    <span class="row-text"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></span>
    <span class="row-album">${esc(t.album || '')}</span>
    <button class="icon-btn small" data-like-key="${esc(keyOf(t))}" data-row-like="${i}" aria-label="Like">${icon('heart')}</button>
    <button class="icon-btn small" data-row-queue="${i}" aria-label="Play next">${icon('plus')}</button>
    <span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
  </div>`;

const skeleton = () =>
  `<div class="rows skeleton">${Array.from({ length: 8 }, (_, i) => `<div class="row" style="--i:${i}"><span class="row-art"><span class="shimmer"></span></span><span class="row-text"><b class="shimmer-line"></b><span class="shimmer-line short"></span></span></div>`).join('')}</div>`;

function markSelected() {
  const on = body.classList.contains('searching');
  $$('#view [data-play]').forEach((el) => el.classList.toggle('sel', on && Number(el.dataset.play) === selected));
}
function markPlayingRows() {
  const k = current() && keyOf(current());
  $$('#view .row[data-key]').forEach((el) => el.classList.toggle('now', el.dataset.key === k));
}

// ---------- imports and links ----------

async function importSpotify(url) {
  input.value = '';
  input.blur();
  body.classList.remove('searching');
  view.innerHTML = `<div class="importing"><span class="loader"></span><p>Bringing your music over from Spotify</p></div>`;
  try {
    const pl = await engine.importPlaylist(url);
    toast(`${icon('spark', 'tiny')} Brought over <b>${pl.tracks.length}</b> ${pl.tracks.length === 1 ? 'song' : 'songs'} from Spotify`);
    if (pl.kind === 'track') {
      location.hash = '#/';
      return engine.playList(pl.tracks, 0, { name: 'Spotify link', href: '#/' });
    }
    const prev = lib.playlists.find((p) => p.id === pl.id);
    if (prev) Object.assign(prev, pl, { tracks: pl.tracks.map((t) => prev.tracks.find((o) => o.title === t.title && o.artist === t.artist) || t) });
    else lib.playlists.unshift(pl);
    saveLib();
    location.hash = `#/pl/${encodeURIComponent(pl.id)}`;
  } catch (e) {
    view.innerHTML = `<div class="empty">${esc(e.message)}<br><span>Only public playlists, albums and tracks can be imported.</span></div>`;
  }
}

async function playYouTube(id, opts) {
  input.value = '';
  try {
    await engine.playYouTube(id, opts);
  } catch (e) {
    toast(esc(e.message), 'err');
  }
}

// ---------- playlists ----------

function playlistById(id) {
  if (id === 'liked') return { id: 'liked', name: 'Liked songs', tracks: lib.liked, liked: true };
  return lib.playlists.find((p) => p.id === id);
}

function renderPlaylist(id) {
  const pl = playlistById(id);
  if (!pl) return (view.innerHTML = '<div class="empty">That playlist is not in your library anymore.</div>');
  const total = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0);
  view.innerHTML = `
    <section class="pl-hero">
      <div class="pl-hero-cover">${pl.liked ? likedArt(icon('heartFill')) : cover(pl, 500)}</div>
      <div class="pl-hero-text">
        <span class="eyebrow">${pl.liked ? 'Your favourites' : pl.kind === 'album' ? 'Album' : 'Playlist'}${pl.source === 'spotify' ? ' · brought over from Spotify' : ''}</span>
        <h2>${esc(pl.name)}</h2>
        <p>${pl.by ? `${esc(pl.by)} · ` : ''}${pl.tracks.length} songs${total ? ` · ${Math.round(total / 60)} min` : ''}</p>
        <div class="pl-actions">
          <button class="play big-play" data-act="play-pl" aria-label="Play">${icon('play')}</button>
          <button class="pill" data-act="shuffle-pl">${icon('shuffle')} Shuffle</button>
          ${pl.liked ? '' : `<button class="icon-btn" data-act="delete-pl" aria-label="Remove playlist">${icon('trash')}</button>`}
        </div>
      </div>
    </section>
    <div class="rows numbered">${pl.tracks.length ? pl.tracks.map((t, i) => row(t, i, i + 1)).join('') : '<div class="empty small">Tap the heart on any song and it lands here.</div>'}</div>`;
  markPlayingRows();
  paintLikes();
  fillArt(pl);
}

// Find each imported song on YouTube in the background so covers fade in.
let fillToken = 0;
async function fillArt(pl) {
  const token = ++fillToken;
  const todo = pl.tracks.filter((t) => !t.id);
  const worker = async () => {
    while (todo.length && token === fillToken) {
      const t = todo.shift();
      const before = `${t.title}|${t.artist}`.toLowerCase();
      try {
        await engine.resolve(t);
        const el = $(`#view .row[data-key="${CSS.escape(before)}"]`);
        if (!el) continue;
        el.dataset.key = keyOf(t);
        if (t.art) $('.row-art', el).insertAdjacentHTML('afterbegin', `<img src="${esc(sized(t.art, 96))}"${fb(t)} alt="" class="fade" decoding="async">`);
        $('.row-art .shimmer', el)?.remove();
        if (!$('.row-album', el).textContent) $('.row-album', el).textContent = t.album || '';
        if (!$('.dur', el).textContent && t.duration) $('.dur', el).textContent = fmt(t.duration);
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---------- routing ----------

// Playlist covers morph into the playlist page and back.
let prevHash = location.hash;
const plKey = (h) => h.match(/^#\/(pl\/.+|liked)$/)?.[1];
const clearMorph = () => $$('[style*="view-transition-name"]').forEach((el) => (el.style.viewTransitionName = ''));

function route() {
  const from = prevHash;
  prevHash = location.hash;
  const fromPl = plKey(from), toPl = plKey(location.hash);
  const animate = route.painted && !document.hidden && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let morphTo = null;
  clearMorph();
  if (animate && toPl && !fromPl) {
    const card = $(`#view a.pl-card[href="#/${toPl}"] .pl-cover`);
    if (card) (card.style.viewTransitionName = 'cover'), (morphTo = '#view .pl-hero-cover');
  } else if (animate && fromPl && !toPl) {
    const hero = $('#view .pl-hero-cover');
    if (hero) (hero.style.viewTransitionName = 'cover'), (morphTo = `#view a.pl-card[href="#/${fromPl}"] .pl-cover`);
  }
  const h = location.hash.slice(1) || '/';
  const [, kind, arg = ''] = h.match(/^\/(\w*)\/?(.*)$/) || [];
  const param = decodeURIComponent(arg);
  body.classList.toggle('home', !kind || kind === 's');
  body.classList.toggle('searching', kind === 'search');
  if (kind !== 'search' && document.activeElement !== input) input.value = '';
  const paint = () => {
    if (!kind) renderHome();
    else if (kind === 'search') {
      if (input.value !== param) input.value = param;
      runSearch(param);
    } else if (kind === 'liked') renderPlaylist('liked');
    else if (kind === 'pl') renderPlaylist(param);
    else if (kind === 's' && param) {
      renderHome();
      if ((current()?.playId || current()?.id) !== param) playYouTube(param, { autoplay: false }).then(() => openNP('lyrics'));
    } else renderHome();
    paintArt(view);
    if (morphTo) {
      const el = $(morphTo);
      if (el) el.style.viewTransitionName = 'cover';
    }
    scrollTo({ top: 0 });
  };
  if (animate) {
    const vt = document.startViewTransition(paint);
    [vt.ready, vt.updateCallbackDone].forEach((p) => p.catch(() => {}));
    vt.finished.then(clearMorph, clearMorph);
  } else paint();
  route.painted = true;
  placeStage();
}
addEventListener('hashchange', route);

const liveSearch = debounce(() => {
  const v = input.value;
  if (!v.trim()) {
    if (location.hash.startsWith('#/search')) location.hash = '#/';
    return;
  }
  if (spotifyLink(v) || youtubeId(v)) return runSearch(v);
  const target = `#/search/${encodeURIComponent(v.trim())}`;
  if (location.hash.startsWith('#/search')) {
    history.replaceState(null, '', target);
    body.classList.add('searching');
    body.classList.remove('home');
    runSearch(v);
  } else location.hash = target;
}, 160);
input.addEventListener('input', liveSearch);
input.addEventListener('keydown', (e) => {
  const rows = $$('#view [data-play]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = Math.max(0, Math.min(rows.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
    markSelected();
    $(`#view [data-play="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (spotifyLink(input.value) || youtubeId(input.value)) return runSearch(input.value);
    if (results.length && body.classList.contains('searching')) playResult(selected);
  }
  if (e.key === 'Escape') {
    input.value = '';
    input.blur();
    location.hash = '#/';
  }
});

function playResult(i) {
  const t = results[i];
  if (!t) return;
  engine.playList([{ ...t }], 0, { name: `“${input.value.trim() || t.title}”`, href: location.hash }, { keepOrder: true });
}

// The hero search scrolls away on the home page. A slim bar takes over before
// the search box can slide under anything pinned to the top (like the notch island).
let scrollFrame = 0;
const checkScrolled = () => {
  scrollFrame = 0;
  const notchRoom = body.classList.contains('notch') && body.classList.contains('has-track') ? 50 : 0;
  body.classList.toggle('scrolled', $('.search').getBoundingClientRect().top < notchRoom + 64);
};
addEventListener('scroll', () => scrollFrame || (scrollFrame = requestAnimationFrame(checkScrolled)), { passive: true });
addEventListener('resize', checkScrolled);
checkScrolled();

// ---------- interactions ----------

function viewList() {
  const h = location.hash;
  if (h.startsWith('#/search')) return results;
  if (h.startsWith('#/liked')) return lib.liked;
  if (h.startsWith('#/pl/')) return playlistById(decodeURIComponent(h.slice(5)))?.tracks || [];
  return [];
}
const viewPlaylist = () => playlistById(location.hash.startsWith('#/liked') ? 'liked' : decodeURIComponent(location.hash.slice(5)));

view.addEventListener('pointerover', (e) => {
  const s = e.target.closest('[data-station]');
  if (s && !s.dataset.warm) {
    s.dataset.warm = 1;
    prefetchStation(STATIONS[s.dataset.station]);
  }
});
view.addEventListener('click', (e) => {
  const station = e.target.closest('[data-station]');
  if (station) return startStation(STATIONS[station.dataset.station]);
  const recent = e.target.closest('[data-recent]');
  if (recent) return engine.playList(lib.recent.map((t) => ({ ...t })), Number(recent.dataset.recent), { name: 'Recently played', href: '#/' }, { keepOrder: true });
  const like = e.target.closest('[data-row-like]');
  if (like) return toggleLike(viewList()[Number(like.dataset.rowLike)]);
  const queueBtn = e.target.closest('[data-row-queue]');
  if (queueBtn) {
    const t = viewList()[Number(queueBtn.dataset.rowQueue)];
    if (!t) return;
    engine.insertNext(t);
    return toast(`Playing <b>${esc(t.title)}</b> next`);
  }
  const play = e.target.closest('[data-play]');
  if (play) {
    const i = Number(play.dataset.play);
    if (location.hash.startsWith('#/search')) return playResult(i);
    const pl = viewPlaylist();
    if (pl) engine.playList(pl.tracks, i, { name: pl.name, href: location.hash }, { keepOrder: true });
  }
});

const actions = {
  toggle: () => (current() ? engine.toggle() : startStation(STATIONS[Math.floor(Math.random() * STATIONS.length)])),
  next: () => engine.next(),
  prev: () => engine.prev(),
  open: () => openNP(),
  close: closeNP,
  lyrics: () => openNP('lyrics'),
  queue: () => openNP('queue'),
  like: () => toggleLike(current()),
  shuffle() {
    engine.toggleShuffle();
    toast(engine.shuffle ? 'Shuffle on' : 'Shuffle off');
  },
  repeat() {
    engine.cycleRepeat();
    toast({ off: 'Repeat off', all: 'Repeating the queue', one: 'Repeating this song' }[engine.repeat]);
  },
  mute: () => engine.toggleMute(),
  popout: () => popOut(),
  notch() {
    const on = !body.classList.contains('notch');
    body.classList.toggle('notch', on);
    store.set('notch', on);
    $('#island').classList.remove('open');
    lastRect = null;
    placeStage();
    fitIsland();
    checkScrolled();
    toast(on ? 'Notch mode on. Hover the island to open it.' : 'Back to the bottom bar');
  },
  async install() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      if (outcome === 'accepted') $('[data-act="install"]').hidden = true;
    } else toast('Tap the Share button, then <b>Add to Home Screen</b>');
  },
  'side-toggle'() {
    body.classList.toggle('side-off');
    store.set('sideOff', body.classList.contains('side-off'));
    lastRect = null;
    placeStage();
  },
  search() {
    scrollTo({ top: 0, behavior: 'smooth' });
    input.focus({ preventScroll: true });
  },
  tap() {
    body.classList.remove('needs-tap');
    engine.play();
  },
  async share() {
    const t = current();
    const id = t?.playId || t?.id;
    if (!id) return;
    const url = `${location.origin}/s/${id}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: `${t.title} · ${t.artist}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(`${icon('link', 'tiny')} Link copied. Anyone can open it and play.`);
      }
    } catch {}
  },
  'import-help'() {
    actions.search();
    toast('Copy a playlist link in Spotify, then press <b>⌘V</b> anywhere here');
  },
  'play-pl'() {
    const pl = viewPlaylist();
    if (pl?.tracks.length) engine.playList(pl.tracks, 0, { name: pl.name, href: location.hash }, { keepOrder: !engine.shuffle });
  },
  'shuffle-pl'() {
    const pl = viewPlaylist();
    if (!pl?.tracks.length) return;
    const list = [...pl.tracks].sort(() => Math.random() - 0.5);
    engine.playList(list, 0, { name: pl.name, href: location.hash }, { keepOrder: true });
  },
  'delete-pl'() {
    const id = decodeURIComponent(location.hash.slice(5));
    lib.playlists = lib.playlists.filter((p) => p.id !== id);
    saveLib();
    toast('Playlist removed');
    location.hash = '#/';
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  actions[el.dataset.act]?.();
});
$$('.tabs [data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    setTab(b.dataset.tab);
    if (b.dataset.tab === 'queue' && renderQueue.stale) renderQueue();
  }),
);

// Paste or drop a link anywhere and it just works.
document.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  if (spotifyLink(text) || youtubeId(text)) {
    e.preventDefault();
    return runSearch(text);
  }
  if (e.target !== input && text.trim() && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
    input.value = text.trim();
    input.focus();
    liveSearch();
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
  if (text) runSearch(text);
});

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const k = e.key;
  const cmd = e.metaKey || e.ctrlKey;
  if (k === '/' || (k === 'k' && cmd)) {
    e.preventDefault();
    if (npOpen) closeNP();
    input.focus();
    input.select();
    return;
  }
  if (cmd || e.altKey) return;
  if (k === ' ') (e.preventDefault(), actions.toggle());
  else if (k === 'ArrowRight') e.shiftKey ? engine.next() : engine.seek(engine.time + 5);
  else if (k === 'ArrowLeft') e.shiftKey ? engine.prev() : engine.seek(engine.time - 5);
  else if (k === 'ArrowUp' && npOpen) (e.preventDefault(), engine.setVolume(engine.volume + 0.05));
  else if (k === 'ArrowDown' && npOpen) (e.preventDefault(), engine.setVolume(engine.volume - 0.05));
  else if (k === 'l') npOpen && !$('#lyrics').hidden ? closeNP() : openNP('lyrics');
  else if (k === 'q') (openNP('queue'), renderQueue());
  else if (k === 'm') actions.mute();
  else if (k === 'p') popOut();
  else if (k === 'n') actions.notch();
  else if (k === 's') actions.shuffle();
  else if (k === 'Escape' && npOpen) closeNP();
});

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => engine.play());
  ms.setActionHandler('pause', () => engine.pause());
  ms.setActionHandler('nexttrack', () => engine.next());
  ms.setActionHandler('previoustrack', () => engine.prev());
  // Chrome can open the pop-out by itself when you switch tabs mid-song.
  try {
    ms.setActionHandler('enterpictureinpicture', () => popOut());
  } catch {}
}

// ---------- notch island ----------

const island = $('#island');
body.classList.toggle('notch', store.get('notch', false));
let islandTimer;
const openIsland = (on) => {
  clearTimeout(islandTimer);
  island.classList.toggle('open', on);
};
const fineHover = matchMedia('(hover: hover) and (pointer: fine)');
island.addEventListener('pointerenter', () => fineHover.matches && (islandTimer = setTimeout(() => openIsland(true), 120)));
island.addEventListener('pointerleave', () => fineHover.matches && (clearTimeout(islandTimer), (islandTimer = setTimeout(() => openIsland(false), 380))));
$('.isl-compact').addEventListener('click', () => openIsland(true));
document.addEventListener('pointerdown', (e) => island.classList.contains('open') && !island.contains(e.target) && openIsland(false));

// The compact island is as wide as what it is saying, within reason.
function fitIsland() {
  const line = $('.isl-line');
  const text = line.scrollWidth;
  island.style.setProperty('--iw', `${Math.max(180, Math.min(text + 80, Math.min(380, innerWidth - 24)))}px`);
}
let islandIdx = -2;
function islandLine(time) {
  const t = current();
  if (!t) return;
  const lines = lyrics.lines;
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= time + 0.15; k++) i = k;
  const key = lines.length ? i : `${t.title}|${t.artist}`;
  if (key === islandIdx) return;
  islandIdx = key;
  const text = lines.length && i >= 0 ? lines[i].text || '♪' : `${t.title} · ${t.artist}`;
  const el = $('.isl-line');
  el.textContent = text;
  el.classList.remove('in');
  void el.offsetWidth;
  el.classList.add('in');
  $('.isl-lyric').textContent = lines.length && i >= 0 ? lines[i].text || '♪' : '';
  fitIsland();
  if (lines.length && !island.classList.contains('open')) {
    island.classList.add('bump');
    setTimeout(() => island.classList.remove('bump'), 260);
  }
}

// ---------- bridge for the desktop notch (and any same-site window) ----------

// notch.html, in the desktop app or a plain popup, listens here and sends commands back.
const bridge = 'BroadcastChannel' in window ? new BroadcastChannel('hum-bridge') : null;
let bridgeLine = '';
function shareState() {
  const t = current();
  if (!bridge) return;
  bridge.postMessage({
    type: 'state',
    ...engine.snapshot(),
    art: t?.art ? sized(t.art, 240) : t?.id ? `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg` : '',
    artFallback: t?.id ? `https://i.ytimg.com/vi/${t.playId || t.id}/mqdefault.jpg` : '',
    liked: isLiked(t),
    line: bridgeLine,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    palette: [1, 2, 3, 4].map((i) => getComputedStyle(document.documentElement).getPropertyValue(`--p${i}`).trim()),
    at: Date.now(),
  });
}
if (bridge) {
  ['track', 'playing', 'queue', 'modes'].forEach((ev) => engine.addEventListener(ev, () => setTimeout(shareState, 60)));
  bridge.onmessage = async ({ data }) => {
    if (data?.type !== 'cmd') return;
    if (data.cmd === 'hello') return shareState();
    if (data.cmd === 'like') return toggleLike(current()), shareState();
    if (data.cmd === 'open') return openNP('lyrics');
    try {
      await engine.command(data);
    } catch {}
    shareState();
  };
  // Timers keep running when the window is hidden, unlike animation frames.
  setInterval(() => {
    const lines = lyrics.lines;
    if (!current()) return;
    const time = engine.time;
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= time + 0.15; k++) i = k;
    const line = i >= 0 ? lines[i].text || '♪' : '';
    if (line !== bridgeLine) {
      bridgeLine = line;
      shareState();
    }
  }, 300);
  setInterval(shareState, 5000);
}

// ---------- install as an app ----------

// Chrome, Edge and Android offer a real install prompt. iPhone needs Share, Add to Home Screen.
let installPrompt = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('[data-act="install"]').hidden = false;
});
addEventListener('appinstalled', () => ($('[data-act="install"]').hidden = true));
if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) $('[data-act="install"]').hidden = false;

// ---------- pop-out mini player ----------

let pipWin = null;
async function popOut() {
  if (pipWin) return pipWin.focus();
  if (!current()) return toast('Play something first, then pop it out');
  if (!('documentPictureInPicture' in window)) return toast('Pop-out needs Chrome or Edge. Music keeps playing in a background tab either way.');
  let win;
  try {
    win = await documentPictureInPicture.requestWindow({ width: 340, height: 440 });
  } catch (e) {
    return toast(/activation/i.test(e.message) ? 'Click the pop-out button again to open it.' : 'This browser cannot open floating windows. Try Chrome or Edge.');
  }
  pipWin = win;
  const d = win.document;
  d.head.innerHTML = `<meta charset="utf-8"><title>hum</title>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${new URL('widget.css', location.href)}">`;
  d.documentElement.style.setProperty('--accent', getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  d.body.className = 'pip has-track';
  d.body.innerHTML = `
    <div class="w">
      <div class="w-screen"></div>
      <div class="w-meta"><div class="w-text"><b class="w-title"></b><span class="w-artist"></span></div></div>
      <p class="w-line"></p>
      <div class="w-progress"><div class="w-bar"><div class="w-fill"></div></div><span class="w-time"></span></div>
      <div class="w-controls">
        <button data-x="prev" aria-label="Previous">${icon('prev')}</button>
        <button data-x="toggle" class="w-play" aria-label="Play"></button>
        <button data-x="next" aria-label="Next">${icon('next')}</button>
      </div>
    </div>`;
  const q = (sel) => d.querySelector(sel);
  const paint = () => {
    const t = current();
    if (!t) return;
    q('.w-title').textContent = t.title;
    q('.w-artist').textContent = t.artist;
    q('.w-play').innerHTML = icon(engine.playing ? 'pause' : 'play');
    d.documentElement.style.setProperty('--accent', getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  };
  const onTrack = () => setTimeout(paint, 50);
  engine.addEventListener('track', onTrack);
  engine.addEventListener('playing', paint);
  d.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'toggle') engine.toggle();
    if (x === 'next') engine.next();
    if (x === 'prev') engine.prev();
  });
  q('.w-bar').addEventListener('pointerdown', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    engine.seek(((e.clientX - r.left) / r.width) * engine.duration);
  });
  let lineIdx = -2;
  const loop = () => {
    if (pipWin !== win) return;
    win.requestAnimationFrame(loop);
    const cur = engine.time, dur = engine.duration;
    q('.w-fill').style.transform = `scaleX(${dur ? Math.min(1, cur / dur) : 0})`;
    q('.w-time').textContent = `${fmt(cur)} / ${fmt(dur)}`;
    const lines = lyrics.lines;
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= cur + 0.15; k++) i = k;
    if (i !== lineIdx) {
      lineIdx = i;
      q('.w-line').textContent = i >= 0 ? lines[i].text || '♪' : '';
    }
  };
  paint();
  body.classList.add('popped');
  if (npOpen) closeNP();
  placeStage();
  await engine.player.moveTo(q('.w-screen'));
  win.requestAnimationFrame(loop);
  win.addEventListener('pagehide', async () => {
    pipWin = null;
    engine.removeEventListener('track', onTrack);
    engine.removeEventListener('playing', paint);
    body.classList.remove('popped');
    const was = engine.playing;
    lastRect = null;
    placeStage();
    await engine.player.moveTo(stage, { resume: was });
    engine.player.setVolume(engine.volume);
    placeStage();
    if (was) setTimeout(() => !engine.playing && body.classList.add('needs-tap'), 2500);
  });
}

// ---------- boot ----------

// Handy for debugging and end-to-end tests.
window.__hum = { engine };

initImages();
initTilt(view);
initArtMotion(view);
initPeek(view, (rowEl) => viewList()[Number(rowEl.dataset.play)]);

// Phones get a placeholder that fits.
const narrow = matchMedia('(max-width: 520px)');
const fitPlaceholder = () => (input.placeholder = narrow.matches ? 'Search or paste a link' : 'Search any song, or paste a Spotify link');
narrow.addEventListener('change', fitPlaceholder);
fitPlaceholder();

function paintIcons() {
  const map = { notch: 'notch', popout: 'pip', 'side-toggle': 'panel', close: 'down', share: 'link', prev: 'prev', next: 'next', lyrics: 'mic', queue: 'queue', open: 'expand', shuffle: 'shuffle' };
  $$('button[data-act]').forEach((b) => map[b.dataset.act] && !b.innerHTML.trim() && (b.innerHTML = icon(map[b.dataset.act])));
  $('#side [data-act="side-toggle"]').innerHTML = icon('right');
  $$('.search-icon').forEach((el) => (el.innerHTML = icon('search')));
  $$('.top-liked').forEach((el) => (el.innerHTML = icon('heart')));
  $$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}

// Pick up where you left off, paused, so nothing blasts on page load.
function restore() {
  const s = store.get('session', null);
  if (!s?.list?.length) return;
  engine.list = s.list;
  engine.i = Math.min(s.i, s.list.length - 1);
  engine.ctx = s.ctx || engine.ctx;
  const t = current();
  if (!t?.id) return;
  t.tried = [t.id];
  showTrack(t);
  engine.player.load(t.id, { autoplay: false, start: Math.floor(s.t || 0) });
}
const saveSession = () => {
  const t = current();
  if (!t) return;
  const from = Math.max(0, engine.i - 20);
  store.set('session', { list: engine.list.slice(from, engine.i + 80).map(({ tried, alts, ...x }) => x), i: engine.i - from, ctx: engine.ctx, t: engine.time });
};
setInterval(saveSession, 4000);
addEventListener('pagehide', saveSession);

paintIcons();
paintModes();
setPlaying(false);
if (!/^#\/s\//.test(location.hash)) restore();
route();
const ro = new ResizeObserver(() => placeStage());
ro.observe($('#np-slot'));
ro.observe($('#side-slot'));
side.addEventListener('animationend', () => {
  lastRect = null;
  placeStage();
});
