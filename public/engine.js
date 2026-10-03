// The playback brain shared by the full app and the embeddable widget.
// It owns the queue, finds songs on YouTube, keeps autoplay going and recovers
// from uploads that refuse to play. UIs listen to its events and draw.
import { Player } from './player.js';

export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(`hum:${k}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`hum:${k}`, JSON.stringify(v));
    } catch {}
  },
};

// Same request twice returns the same promise, so hover-prefetch makes clicks instant.
const apiCache = new Map();
export async function api(path, params, { cache = path !== 'import' } = {}) {
  const url = `${API_BASE}/api/${path}?${new URLSearchParams(params)}`;
  if (cache && apiCache.has(url)) return apiCache.get(url);
  const job = fetch(url).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Network hiccup. Try again.');
    return data;
  });
  if (cache) {
    apiCache.set(url, job);
    job.catch(() => apiCache.delete(url));
  }
  return job;
}
const API_BASE = new URL('.', import.meta.url).href.replace(/\/$/, '');

export const keyOf = (t) => t.id || `${t.title}|${t.artist}`.toLowerCase();
export const nameKey = (t) => `${t.title}|${t.artist}`.toLowerCase();
export const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
export const spotifyLink = (s) => /open\.spotify\.com\/(intl-\w+\/)?(playlist|album|track)\/[A-Za-z0-9]{22}|spotify:(playlist|album|track):/.test(s);
export const youtubeId = (s) => s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/)?.[1];

// Covers come huge. Ask the CDN for the size we actually draw.
export function sized(url, px) {
  if (!url) return '';
  if (/googleusercontent|ggpht/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);
  if (/ytimg\.com/.test(url)) return url.replace(/(hq|mq|sd|maxres)?default/, px > 320 ? 'hqdefault' : 'mqdefault');
  if (/scdn\.co|spotifycdn/.test(url)) return url.replace(/ab67616d0000(b273|1e02|4851)/, `ab67616d0000${px > 300 ? 'b273' : px > 64 ? '1e02' : '4851'}`);
  return url;
}

// Fisher-Yates: every order equally likely.
export function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Engine extends EventTarget {
  constructor(playerEl, { onResolve } = {}) {
    super();
    this.player = new Player(playerEl);
    this.onResolve = onResolve;
    this.list = [];
    this.i = -1;
    this.ctx = { name: 'Search', href: '#/' };
    this.shuffle = store.get('shuffle', false);
    this.repeat = store.get('repeat', 'off');
    this.autoplay = true;
    this.volume = store.get('volume', 0.85);
    this.lastVolume = this.volume || 0.8;
    this.playing = false;
    this.token = 0;
    this.radioFor = null;
    // Why the song on screen is about to be left: switch (default), skip, or error. Listeners read it on 'track'.
    this.exit = 'switch';
    this.player.addEventListener('state', ({ detail }) => this.onState(detail));
    this.player.addEventListener('error', () => this.onError());
  }

  get current() { return this.list[this.i]; }
  get time() { return this.player.time; }
  get duration() { return this.player.duration || this.current?.duration || 0; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  notice(message) { this.emit('notice', message); }
  warm() { this.player.warm().then(() => this.player.setVolume(this.volume)); }

  async resolve(t) {
    if (t.id) return t;
    const [hit] = await api('search', { q: `${t.title} ${t.artist}`, limit: 1 });
    if (!hit) throw new Error('not found');
    t.id = hit.id;
    t.art ||= hit.art;
    t.album ||= hit.album;
    t.duration ||= hit.duration;
    this.onResolve?.(t);
    return t;
  }

  async playList(list, i = 0, ctx = this.ctx, opts = {}) {
    this.list = [...list];
    this.i = i;
    this.ctx = ctx;
    this.radioFor = null;
    this.exit = 'switch';
    // Shuffle keeps the song that starts and mixes the rest, however playback began.
    if (this.shuffle) this.shuffleUpcoming();
    await this.start(opts);
  }

  async start({ autoplay = true, at = 0 } = {}) {
    const t = this.current;
    if (!t) return;
    const token = ++this.token;
    t.tried = [];
    t.alts = null;
    this.emit('track', t);
    this.exit = 'switch';
    try {
      await this.resolve(t);
    } catch {
      if (token !== this.token) return;
      this.notice(`Could not find “${t.title}”. Skipping.`);
      return this.next(false, 'error');
    }
    if (token !== this.token) return;
    this.emit('track', t);
    t.tried.push(t.id);
    await this.player.load(t.id, { autoplay, start: at });
    this.player.setVolume(this.volume);
    if (autoplay) this.watchForBlock(token);
    this.emit('started', t);
    this.topUpRadio();
    const after = this.list[this.i + 1];
    if (after && !after.id) this.resolve(after).catch(() => {});
  }

  // Browsers refuse sound until the page has been touched once. Tell the UI so it can ask.
  watchForBlock(token) {
    setTimeout(() => {
      if (token === this.token && !this.playing && [-1, 5].includes(this.player.state)) this.emit('blocked');
    }, 3500);
  }

  next(auto = false, exit = auto ? 'end' : 'skip') {
    if (auto && this.repeat === 'one') return this.player.seek(0), this.player.play();
    if (this.i < this.list.length - 1) this.i++;
    else if (this.repeat === 'all' && this.list.length) this.i = 0;
    else return auto ? null : this.notice('That was the last song in the queue');
    this.exit = exit;
    this.start();
  }
  prev() {
    if (this.player.time > 3 || this.i <= 0) return this.player.seek(0);
    this.i--;
    this.start();
  }
  play() { this.player.play(); }
  pause() { this.player.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) { this.player.seek(t); }
  jump(i) {
    if (i === this.i || !this.list[i]) return;
    this.i = i;
    this.exit = 'skip';
    this.start();
  }
  remove(i) {
    if (i === this.i) return;
    this.list.splice(i, 1);
    if (i < this.i) this.i--;
    this.emit('queue');
  }
  insertNext(t) {
    if (!this.current) return this.playList([{ ...t }], 0, this.ctx, { keepOrder: true });
    this.list.splice(this.i + 1, 0, { ...t });
    this.emit('queue');
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.volume > 0) this.lastVolume = this.volume;
    this.player.setVolume(this.volume);
    store.set('volume', this.volume);
    this.emit('modes');
  }
  toggleMute() { this.setVolume(this.volume > 0 ? 0 : this.lastVolume); }
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    store.set('shuffle', this.shuffle);
    if (this.shuffle) this.shuffleUpcoming();
    this.emit('queue');
    this.emit('modes');
  }
  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    store.set('repeat', this.repeat);
    this.emit('modes');
  }
  shuffleUpcoming() {
    this.list = [...this.list.slice(0, this.i + 1), ...shuffled(this.list.slice(this.i + 1))];
  }

  async topUpRadio() {
    const t = this.current;
    if (!this.autoplay || !t?.id || this.list.length - this.i > 4 || this.radioFor === t.id) return;
    this.radioFor = t.id;
    try {
      const mix = await api('radio', { id: t.id });
      const have = new Set([...this.list.map(keyOf), ...this.list.map(nameKey)]);
      const more = mix.filter((x) => !have.has(keyOf(x)) && !have.has(nameKey(x))).map((x) => ({ ...x, radio: true }));
      this.list.push(...(this.shuffle ? shuffled(more) : more));
      this.emit('queue');
    } catch {}
  }

  // ---- high level verbs, shared by the app, the widget, postMessage and agents ----

  async playQuery(query, ctxName, opts = {}) {
    const [hit] = await api('search', { q: query, limit: 1 });
    if (!hit) throw new Error(`Nothing found for “${query}”`);
    await this.playList([{ ...hit }], 0, { name: ctxName || `“${query}”`, href: '#/' }, { keepOrder: true, ...opts });
    return hit;
  }
  async station(seed, name, opts = {}) {
    const [hit] = await api('search', { q: seed, limit: 1 });
    if (!hit) throw new Error(`Nothing found for “${seed}”`);
    const mix = await api('radio', { id: hit.id });
    // A station should sound different each time: its mix comes back in a fixed order, so it
    // is shuffled behind the opening song even with shuffle off.
    const list = [{ ...hit }, ...shuffled(mix.filter((x) => x.id !== hit.id).map((x) => ({ ...x, radio: true })))];
    await this.playList(list, 0, { name: name || seed, href: '#/', key: seed }, { keepOrder: true, ...opts });
    return hit;
  }
  async playYouTube(id, opts = {}) {
    const mix = await api('radio', { id });
    const list = mix.length ? mix : [{ id, title: 'YouTube video', artist: '' }];
    list.forEach((x, i) => i && (x.radio = true));
    await this.playList(list, 0, { name: 'Shared song', href: '#/' }, { keepOrder: true, ...opts });
  }
  async importPlaylist(url) {
    const pl = await api('import', { url: url.trim() });
    return pl;
  }

  // One entry point for remote control. Returns a short human summary.
  async command(msg) {
    const c = msg.cmd || msg.hum;
    const say = (t) => (t ? `${t.title} by ${t.artist}` : 'nothing');
    switch (c) {
      case 'play':
        if (msg.query) return `Playing ${say(await this.playQuery(msg.query))}`;
        this.play();
        return 'Resumed';
      case 'station':
        await this.station(msg.mood || msg.query, msg.name || msg.mood);
        return `Started a station from “${msg.mood || msg.query}”, opening with ${say(this.current)}`;
      case 'playlist': {
        const pl = await this.importPlaylist(msg.url);
        await this.playList(pl.tracks, 0, { name: pl.name, href: '#/' });
        return `Playing ${pl.name} (${pl.tracks.length} songs)`;
      }
      case 'pause': this.pause(); return 'Paused';
      case 'resume': this.play(); return 'Resumed';
      case 'toggle': this.toggle(); return this.playing ? 'Paused' : 'Resumed';
      case 'next': this.next(); return 'Skipped';
      case 'prev':
      case 'previous': this.prev(); return 'Went back';
      // level is always a percentage; value is a 0 to 1 fraction (older callers sent 0 to 100)
      case 'volume': this.setVolume(msg.level != null ? Number(msg.level) / 100 : Number(msg.value) > 1 ? Number(msg.value) / 100 : Number(msg.value)); return `Volume ${Math.round(this.volume * 100)}%`;
      case 'seek': this.seek(Number(msg.seconds) || 0); return 'Seeked';
      // step the music down while something needs your attention, then bring it back
      case 'duck':
        if (this.preDuck == null) this.preDuck = this.volume;
        this.setVolume(this.preDuck * (Number(msg.level ?? 30) / 100));
        return `Ducked to ${Math.round(this.volume * 100)}%`;
      case 'unduck':
        if (this.preDuck != null) this.setVolume(this.preDuck);
        this.preDuck = null;
        return `Volume ${Math.round(this.volume * 100)}%`;
      default: throw new Error(`Unknown command ${c}`);
    }
  }

  snapshot() {
    const t = this.current;
    const lines = (this.lyricLines?.() || []).map((l) => ({ t: l.t, text: l.text }));
    return {
      playing: this.playing,
      track: t ? { title: t.title, artist: t.artist, album: t.album || '', art: t.art || '', id: t.playId || t.id || '' } : null,
      position: Math.round(this.time * 10) / 10,
      duration: Math.round(this.duration),
      volume: Math.round(this.volume * 100),
      upNext: this.list.slice(this.i + 1, this.i + 6).map((x) => `${x.title} · ${x.artist}`),
      context: this.ctx.name,
      ducked: this.preDuck != null,
      // synced lyrics, so a terminal can show the line being sung: position + (now - at)
      line: lineAt(lines, this.time),
      lyrics: lines,
      at: Date.now(),
    };
  }

  // ---- player events ----

  onState(s) {
    if (s === 1 && this.current?.tried?.length) this.current.playId = this.current.tried.at(-1);
    if (s === 0) {
      this.emit('ended', this.current);
      this.next(true);
    }
    const on = s === 1 || (s === 3 && this.playing);
    if (on !== this.playing) {
      this.playing = on;
      this.emit('playing', on);
    }
  }

  // When the main upload refuses to play off YouTube, try the next best upload.
  async onError() {
    const t = this.current;
    if (!t) return;
    const token = this.token;
    try {
      t.alts ||= await api('alt', { q: `${t.title} ${t.artist}` });
    } catch {
      t.alts = [];
    }
    if (token !== this.token) return;
    const alt = t.alts.find((id) => !t.tried.includes(id));
    if (alt && t.tried.length < 5) {
      t.tried.push(alt);
      return this.player.load(alt);
    }
    this.notice(`“${t.title}” is not allowed to play here. Skipping.`);
    this.next(false, 'error');
  }
}

// Local remote control: when served by `node server.js` (or the MCP server),
// agents and scripts can drive whichever hum window was opened last.
const lineAt = (lines, time) => {
  let line = '';
  for (const l of lines) if (l.t <= time + 0.15) line = l.text; else break;
  return line;
};

export function connectRemote(engine) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  let es;
  try {
    es = new EventSource(`${API_BASE}/api/remote/events`);
  } catch {
    return;
  }
  let fails = 0;
  es.onerror = () => ++fails > 3 && es.close();
  es.onopen = () => (fails = 0);
  es.onmessage = async (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    let reply;
    try {
      reply = { ok: true, text: await engine.command(msg) };
    } catch (err) {
      reply = { ok: false, text: err.message };
    }
    post('reply', { id: msg.id, ...reply });
  };
  const post = (kind, body) =>
    fetch(`${API_BASE}/api/remote/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  let pending;
  const report = () => {
    clearTimeout(pending);
    pending = setTimeout(() => post('state', engine.snapshot()), 250);
  };
  ['track', 'playing', 'queue', 'modes', 'lyrics'].forEach((t) => engine.addEventListener(t, report));
  setInterval(report, 5000);
}
