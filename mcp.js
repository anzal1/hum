#!/usr/bin/env node
// hum as an MCP server, so any coding agent can play music while you work.
//   claude mcp add hum -- node /path/to/hum/mcp.js
// Zero dependencies. Speaks MCP over stdio, starts the local hum server if needed,
// and opens hum in your browser the first time music is asked for.
// Hosts that support MCP Apps (Claude, ChatGPT, VS Code) get hum's real player as a
// card inside the chat instead. Every other host keeps the browser tab.
// Claude's chat blocks embedded players, so there the card turns into a live remote and
// the sound plays in a hum browser tab (see "the card as a remote for the tab").
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { startServer } from './server.js';

const PORT = Number(process.env.HUM_PORT) || 3737;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_URL = `http://localhost:${PORT}`;
const log = (...a) => console.error('[hum]', ...a);

// ---------- player card (MCP Apps) ----------

const VERSION = '0.2.4';
// The version is part of the card's address, so a host that caches UI resources by
// URI can never show an older card after an update.
const UI_URI = `ui://hum/player-${VERSION}`;
const UI_MIME = 'text/html;profile=mcp-app';
const UI_EXT = 'io.modelcontextprotocol/ui';
// The card is hum's own widget, framed from hum's site, so YouTube sees a real page and referrer.
const CARD_ORIGIN = (() => {
  try {
    return new URL(process.env.HUM_CARD_ORIGIN || 'https://hum.anzalabidi.dev').origin;
  } catch {
    return 'https://hum.anzalabidi.dev';
  }
})();
const UI_RESOURCE_META = { ui: { csp: { frameDomains: [CARD_ORIGIN] }, prefersBorder: true } };
let UI = false; // set at initialize, when the host says it can render MCP Apps

const TOOLS = [
  {
    name: 'play',
    description: 'Play a song on hum. Takes any search: a title, an artist, or both ("Blinding Lights", "Kesariya Arijit Singh"). Music keeps going afterwards with similar songs.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to play' } }, required: ['query'] },
  },
  {
    name: 'station',
    description: 'Start an endless mix in a mood or around a seed song, for example "lofi beats", "deep focus", "90s bollywood", "Nujabes".',
    inputSchema: { type: 'object', properties: { mood: { type: 'string', description: 'A mood, genre, artist or seed song' } }, required: ['mood'] },
  },
  {
    name: 'play_playlist',
    description: 'Play a public Spotify playlist, album or track link through hum.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'open.spotify.com link' } }, required: ['url'] },
  },
  {
    name: 'control',
    description: 'Pause, resume, skip to the next song, or go back to the previous one.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous'] } }, required: ['action'] },
  },
  {
    name: 'volume',
    description: 'Set the volume from 0 to 100.',
    inputSchema: { type: 'object', properties: { level: { type: 'number', minimum: 0, maximum: 100 } }, required: ['level'] },
  },
  {
    name: 'now_playing',
    description: 'What hum is playing right now, the lyric line being sung, and what comes next.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const SHOW_CARD = new Set(['play', 'station', 'play_playlist']);
// The legacy flat key is for hosts that predate the nested one.
const CARD_META = { ui: { resourceUri: UI_URI }, 'ui/resourceUri': UI_URI };
const CARD_SYNC = {
  name: 'card_sync',
  description: 'Internal. The hum player card calls this to report its state and fetch commands. Never call it yourself.',
  inputSchema: {
    type: 'object',
    properties: {
      cardId: { type: 'string' },
      state: { type: 'object' },
      done: { type: 'array', items: { type: 'number' } },
      claim: { type: 'boolean' },
    },
    required: ['cardId'],
  },
  _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] } },
};
// App-only tools for the remote card (used when the host will not frame the player).
const APP_ONLY = { ui: { resourceUri: UI_URI, visibility: ['app'] } };
const FALLBACK_TOOLS = [
  {
    name: 'card_fallback',
    description: 'Internal. The hum card calls this when its host blocks the embedded player, so the music plays in a hum browser tab instead. Never call it yourself.',
    inputSchema: { type: 'object', properties: { cardId: { type: 'string' }, command: { type: 'object' } }, required: ['cardId'] },
    _meta: APP_ONLY,
  },
  {
    name: 'remote_sync',
    description: 'Internal. The hum remote card calls this to read what the hum tab is playing. Never call it yourself.',
    inputSchema: { type: 'object', properties: { cardId: { type: 'string' }, ak: { type: 'string' }, lk: { type: 'string' } } },
    _meta: APP_ONLY,
  },
  {
    name: 'remote_cmd',
    description: 'Internal. A button on the hum remote card. Never call it yourself.',
    inputSchema: { type: 'object', properties: { cmd: { type: 'string' }, level: { type: 'number' }, seconds: { type: 'number' } }, required: ['cmd'] },
    _meta: APP_ONLY,
  },
];
const toolList = () => (UI ? [...TOOLS.map((t) => (SHOW_CARD.has(t.name) ? { ...t, _meta: CARD_META } : t)), CARD_SYNC, ...FALLBACK_TOOLS] : TOOLS);

async function ensureServer() {
  try {
    const r = await fetch(`${BASE}/api/remote/state`);
    if (r.ok) return;
  } catch {}
  await startServer({ port: PORT, log });
}

const getState = () => fetch(`${BASE}/api/remote/state`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url) {
  if (process.env.HUM_NO_OPEN) return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// Make sure a hum window is listening. Returns true if we had to open one.
async function ensureWindow() {
  await ensureServer();
  if ((await getState()).connected) return false;
  openBrowser(APP_URL);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if ((await getState()).connected) return true;
  }
  throw new Error(`Could not reach a hum window. Open ${APP_URL} in your browser and try again.`);
}

async function send(msg) {
  const r = await fetch(`${BASE}/api/remote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
  return r.json();
}

function describe(s) {
  if (!s?.track) return 'Nothing is playing.';
  const t = s.track;
  const lines = [`${s.playing ? 'Playing' : 'Paused on'} “${t.title}” by ${t.artist}${t.album && t.album !== t.title ? ` from ${t.album}` : ''} (${fmt(s.position)} of ${fmt(s.duration)}, volume ${s.volume}%).`];
  const line = liveLine(s);
  if (line) lines.push(`Singing now: “${line}”`);
  if (s.upNext?.length) lines.push(`Up next: ${s.upNext.slice(0, 3).join('; ')}.`);
  return lines.join('\n');
}
// The lyric line being sung right now. The player reports position at time `at`, so move it forward.
function liveLine(s) {
  if (!s.lyrics?.length) return s.line || '';
  const now = (s.position || 0) + (s.playing && s.at ? (Date.now() - s.at) / 1000 : 0) + 0.15;
  const cur = s.lyrics.findLast((l) => l.t <= now);
  return cur?.text?.trim() || '';
}
const fmt = (n) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`;

// ---------- the card as a remote ----------
// The card (in the chat) calls card_sync about once a second with its state and picks up
// queued commands. The last card to report in is the active one; older ones are told to pause.

const FRESH = 6000; // a card that reported in this recently is alive
const card = { id: null, state: null, at: 0, since: 0 };
const retired = new Set();
const outbox = [];
const acks = new Map();
const syncWaiters = new Set();
let cmdSeq = 0;
let expectSince = 0; // when the last play asked for a new card
let expectKey = ''; // which command that card was asked for
let expectCmd = null;
const norm = (c) => `${c?.cmd}|${String(c?.query ?? c?.mood ?? c?.url ?? '').trim()}`;
// Set once a card reports that its host will not frame the player (Claude). From then on
// the music plays in a hum browser tab and the card is a remote for it.
const fb = { on: false, usedFor: 0, at: 0, pausedAt: 0, played: false, pending: null, pendingAt: 0, run: null, busy: false, opening: null, error: '' };

function cardSync({ cardId, state, done = [], claim = false } = {}) {
  if (typeof cardId !== 'string' || !cardId) throw new Error('cardId is required');
  const now = Date.now();
  // A card only takes over when it was just asked for, when someone presses play on it, or
  // when nothing else is playing. A chat reopened later replays its old card; that one must
  // not pause the music you are listening to.
  const playingNow = card.id && now - card.at < FRESH && card.state?.playing;
  const expected = now - expectSince < 15000;
  if (card.id !== cardId && (claim || (!retired.has(cardId) && (!playingNow || expected)))) {
    if (card.id) retired.add(card.id);
    retired.delete(cardId);
    fb.on = false; // a card that can play for itself is back in charge
    Object.assign(card, { id: cardId, state: null, at: now, since: now });
    outbox.length = 0;
  }
  const active = card.id === cardId;
  if (active) {
    if (state && typeof state === 'object') card.state = { ...state, at: now };
    card.at = now;
    for (const id of done) acks.get(id)?.();
  }
  const commands = active ? outbox.splice(0).filter((c) => now - c.at < 10000) : [];
  for (const wake of [...syncWaiters]) wake();
  return { active, commands };
}

const cardLive = () => Boolean(card.id && Date.now() - card.at < FRESH);
const nextSync = (ms) =>
  new Promise((resolve) => {
    const wake = () => (clearTimeout(t), syncWaiters.delete(wake), resolve());
    const t = setTimeout(wake, ms);
    syncWaiters.add(wake);
  });

// Right after a play, the new card needs a few seconds to load and report in.
async function liveCard() {
  const until = Date.now() + 8000;
  while (expectSince && Date.now() - expectSince < 20000 && !(cardLive() && card.since >= expectSince) && !(fb.on && fb.usedFor >= expectSince) && Date.now() < until) await nextSync(500);
  return cardLive();
}

// Queue a command for the card and wait for its next sync to confirm it ran.
async function viaCard(cmd) {
  const id = ++cmdSeq;
  outbox.push({ id, ...cmd, at: Date.now() });
  const acked = await new Promise((resolve) => {
    const t = setTimeout(() => (acks.delete(id), resolve(false)), 5000);
    acks.set(id, () => (clearTimeout(t), acks.delete(id), resolve(true)));
  });
  return { acked, state: card.state };
}
const cardState = () => {
  const s = card.state;
  return s && { ...s, position: (s.position || 0) + (s.playing ? (Date.now() - s.at) / 1000 : 0), at: Date.now() };
};

const NO_PLAYER = 'Nothing is playing on a hum card right now. Ask me to play something.';
const NO_TAB = 'The hum tab is closed, so nothing is playing. Ask me to play something and I will open it.';
const serverUp = () => fetch(`${BASE}/api/remote/state`).then((r) => r.ok, () => false);

// With a card on screen, play tools just hand the command to the card.
function startOnCard(name, args) {
  const q = String(args.query ?? args.mood ?? args.url ?? '').trim();
  if (!q) throw new Error(`${name} needs a ${name === 'play' ? 'query' : name === 'station' ? 'mood' : 'url'}`);
  const command =
    name === 'play' ? { cmd: 'play', query: q } : name === 'station' ? { cmd: 'station', mood: q } : { cmd: 'playlist', url: q };
  expectSince = Date.now();
  expectKey = norm(command);
  expectCmd = command;
  const what = name === 'play' ? `“${q}”` : name === 'station' ? `a ${q} station` : 'that playlist';
  const text = fb.on
    ? `Playing ${what}. The sound comes from the hum tab in the browser; the card above is a live remote for it. If it is silent, tell the user to click the hum tab once.`
    : `Playing ${what} on the hum card above. If the player asks, tap the card once to let the browser play sound.`;
  return {
    content: [{ type: 'text', text }],
    structuredContent: { command },
  };
}

// Control a card that is alive. Returns null when there is none, so the old path can answer.
async function onCard(name, args) {
  if (!(await liveCard())) return null;
  if (name === 'now_playing') return describe(cardState());
  const cmd = name === 'volume' ? { cmd: 'volume', level: args.level } : { cmd: args.action === 'previous' ? 'prev' : args.action };
  const { acked, state } = await viaCard(cmd);
  const s = cardState() || state;
  const body = name === 'volume' ? `Volume ${s?.volume ?? args.level}%.` : args.action === 'pause' ? 'Paused.' : describe(s);
  return acked ? body : `Sent to the hum card, but it has not confirmed yet.\n${describe(s)}`;
}

async function callTool(name, args = {}) {
  if (UI && name === 'control') {
    fb.pausedAt = args.action === 'pause' ? Date.now() : 0;
    if (args.action !== 'pause') (fb.played = false), (fb.at = Date.now());
  }
  if (UI && SHOW_CARD.has(name)) return startOnCard(name, args);
  if (UI && ['now_playing', 'control', 'volume'].includes(name)) {
    const reply = await onCard(name, args);
    if (reply != null) return reply;
    // A play that was just routed to the tab may still be starting.
    if (fb.on && fb.run) await Promise.race([fb.run, sleep(8000)]);
    // No card is reporting in. Use a hum browser tab if one is open, but never start one for this.
    if (!(await serverUp()) || !(await getState()).connected) return fb.on ? NO_TAB : NO_PLAYER;
  }
  if (name === 'now_playing') {
    await ensureServer();
    const s = await getState();
    return s.connected ? describe(s) : 'hum is not open. Ask me to play something and I will open it.';
  }
  const opened = await ensureWindow();
  const msg =
    name === 'play' ? { cmd: 'play', query: args.query } :
    name === 'station' ? { cmd: 'station', mood: args.mood } :
    name === 'play_playlist' ? { cmd: 'playlist', url: args.url } :
    name === 'control' ? { cmd: args.action === 'previous' ? 'prev' : args.action } :
    name === 'volume' ? { cmd: 'volume', value: args.level } :
    null;
  if (!msg) throw new Error(`Unknown tool ${name}`);
  const reply = await send(msg);
  if (!reply.ok) throw new Error(reply.text);
  if (!['play', 'station', 'play_playlist', 'control'].includes(name) || args.action === 'pause') return reply.text;
  await sleep(2500);
  const s = await getState();
  let text = describe(s);
  if (s.track && !s.playing && args.action !== 'pause')
    text += `\nThe browser is holding the sound until someone clicks the hum tab once${opened ? ' (it was just opened)' : ''}. After that first click, everything plays on its own.`;
  return text;
}

// ---------- the card as a remote for the tab ----------
// Claude's chat only lets a card frame 'self', blob: and data: (anthropics/claude-ai-mcp#40),
// so the player cannot run inside the card and YouTube's embed must stay in a real page.
// The card detects that, calls card_fallback, and from then on the music plays in a hum
// browser tab while the card shows the cover, lyrics and buttons for it.

// Open a hum window if none is connected. Never throws; says whether one is connected.
async function tabReady(waitMs = 8000) {
  await ensureServer();
  if ((await getState()).connected) return { connected: true, opened: false };
  fb.opening ??= (async () => {
    openBrowser(APP_URL);
    for (const until = Date.now() + waitMs; Date.now() < until; ) {
      await sleep(250);
      if ((await getState()).connected) return true;
    }
    return false;
  })().finally(() => (fb.opening = null));
  return { connected: await fb.opening, opened: true };
}

const toMsg = (c) =>
  c?.cmd === 'play' && c.query ? { cmd: 'play', query: String(c.query).trim() } :
  c?.cmd === 'station' && c.mood ? { cmd: 'station', mood: String(c.mood).trim() } :
  c?.cmd === 'playlist' && c.url ? { cmd: 'playlist', url: String(c.url).trim() } :
  null;

// Play a command in the tab, opening it first. Remembered when no tab shows up yet.
function playInTab(msg) {
  fb.error = '';
  fb.at = Date.now();
  fb.pausedAt = 0;
  fb.played = false;
  fb.pending = null;
  fb.busy = true;
  const job = (async () => {
    const t = await tabReady();
    if (!t.connected) return void ((fb.pending = msg), (fb.pendingAt = Date.now()));
    const reply = await send(msg);
    if (!reply.ok) fb.error = reply.text || 'hum could not play that';
  })().catch((e) => void (fb.error = e.message)).finally(() => (fb.busy = false));
  fb.run = job;
  return job;
}

// The card tells us its host blocked the player. A card replayed from an old chat registers
// too, but only the card for a play we just asked for gets to start anything.
function cardFallback({ cardId, command } = {}) {
  if (typeof cardId !== 'string' || !cardId) throw new Error('cardId is required');
  const now = Date.now();
  if (!fb.on) log('this host will not frame the player; playing in a hum browser tab, the card is a remote');
  fb.on = true;
  // A card that was shown no command can still start the play we just asked for.
  const msg = toMsg(command) || (command?.cmd ? null : toMsg(expectCmd));
  const asked = msg && now - expectSince < 30000 && fb.usedFor !== expectSince && (!command?.cmd || norm(command) === expectKey);
  if (asked) {
    fb.usedFor = expectSince;
    playInTab(msg);
  }
  for (const wake of [...syncWaiters]) wake();
  return { ok: true, started: Boolean(asked) };
}

// ---- cover art as a data: URI, because the chat will not load images from other sites ----
const sizedArt = (url, px) =>
  /googleusercontent|ggpht/.test(url) ? url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`) :
  /scdn\.co|spotifycdn/.test(url) ? url.replace(/ab67616d0000(b273|1e02|4851)/, `ab67616d0000${px > 300 ? 'b273' : px > 64 ? '1e02' : '4851'}`) :
  url;
const publicHttps = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(x.hostname);
  } catch {
    return false;
  }
};
async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) throw new Error('not an image');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 300000) throw new Error('too big');
  return `data:${type};base64,${buf.toString('base64')}`;
}
const covers = new Map(); // track key -> data URI, '' while loading or when none could be found
function cover(key, t) {
  if (covers.has(key)) return covers.get(key);
  covers.set(key, '');
  if (covers.size > 24) covers.delete(covers.keys().next().value);
  const urls = [t.art && sizedArt(t.art, 240), t.id && `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`].filter((u) => u && publicHttps(u));
  (async () => {
    for (const u of urls) {
      try {
        return covers.set(key, await fetchImage(u));
      } catch {}
    }
  })();
  return '';
}

// What the remote card shows, once a second. Big or slow parts (lyrics, cover) only travel
// when they changed, as the card says which ones it already has (lk, ak).
async function remoteSync({ lk = '', ak = '' } = {}) {
  let s = null;
  try {
    s = await getState();
  } catch {}
  const out = { up: Boolean(s), connected: Boolean(s?.connected), url: APP_URL, error: fb.error };
  if (s?.connected && fb.pending && !fb.busy) {
    // a tab showed up after we gave up waiting for it
    const late = Date.now() - fb.pendingAt < 90000 && fb.pending;
    fb.pending = null;
    if (late) playInTab(late);
  }
  if (!s?.connected) out.hint = fb.busy || fb.pending ? 'waiting' : 'closed';
  if (!s?.track) return out;
  if (!s.connected) return out; // what is left is from a tab that has closed
  const t = s.track;
  const key = `${t.id}|${t.title}`;
  Object.assign(out, {
    playing: Boolean(s.playing), position: s.position || 0, age: s.at ? Date.now() - s.at : 0, duration: s.duration || 0,
    volume: s.volume, track: { title: t.title, artist: t.artist }, key,
  });
  const lines = Array.isArray(s.lyrics) ? s.lyrics : [];
  const lkey = `${key}:${lines.length}`;
  if (lkey !== lk) Object.assign(out, { lk: lkey, lyrics: lines });
  if (ak !== key) {
    const art = cover(key, t);
    if (art) Object.assign(out, { ak: key, art });
  }
  // Browsers keep sound off in a tab nobody has clicked yet: it has a song but never started.
  // Only a report made after our last ask counts; an older one is left over from a closed tab.
  if (s.at >= fb.at) {
    if (s.playing) fb.played = true;
    else if (!fb.played && !fb.pausedAt && Date.now() - fb.at < 60000) out.hint = 'click';
  }
  return out;
}

const REMOTE_CMDS = new Set(['pause', 'resume', 'next', 'prev', 'volume', 'seek']);
async function remoteCmd({ cmd, level, seconds } = {}) {
  if (!REMOTE_CMDS.has(cmd)) throw new Error(`Unknown command ${cmd}`);
  // Someone pressed a button, so open hum if it was closed.
  if (!(await tabReady()).connected) return { ok: false, text: 'No hum tab is open yet.' };
  if (cmd === 'pause') fb.pausedAt = Date.now();
  if (cmd === 'resume') (fb.pausedAt = 0), (fb.played = false), (fb.at = Date.now());
  const reply = await send({ cmd, ...(cmd === 'volume' ? { level } : {}), ...(cmd === 'seek' ? { seconds } : {}) });
  return { ok: Boolean(reply.ok), text: reply.text };
}

// ---------- the view the host shows ----------
// A thin shell. It frames hum's own widget (so YouTube sees a real page and referrer),
// talks MCP Apps to the host, and relays between the host and the widget's postMessage API.

// hum's own aurora and palette code, inlined so the remote card paints like the real player.
let paintCode = null;
function paintSource() {
  if (paintCode != null) return paintCode;
  try {
    const read = (f) => readFileSync(new URL(`./public/${f}`, import.meta.url), 'utf8').replace(/^export /gm, '');
    paintCode = `var Aurora=(function(){${read('aurora.js')}\nreturn Aurora;})();\nvar palette=(function(){${read('palette.js')}\nreturn palette;})();`;
  } catch {
    paintCode = 'var Aurora=null,palette=null;';
  }
  return paintCode;
}

const shell = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>hum</title>
<style>
html,body{margin:0;height:100%;background:#08070b;overflow:hidden;font:13px system-ui,sans-serif}
iframe{display:block;width:100%;height:100%;border:0}
#rc{--accent:255 196 150;--c1:120 52 170;--c2:40 74 170;--c3:190 92 70;--c4:16 11 28;--text:#f6f2ec;--muted:rgb(246 242 236 / .62);--faint:rgb(246 242 236 / .4);--serif:Georgia,'Times New Roman',serif;position:fixed;inset:0;color:var(--text);font:400 14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
#rc[hidden]{display:none}
#aurora{position:fixed;inset:0;width:100%;height:100%}
#aurora.off{background:radial-gradient(100% 80% at 20% 0%,rgb(var(--c1)),transparent 60%),radial-gradient(90% 80% at 100% 100%,rgb(var(--c2)),transparent 60%),rgb(var(--c4))}
.rc{position:relative;height:100%;box-sizing:border-box;padding:16px;display:grid;grid-template-columns:148px 1fr;grid-template-rows:auto auto auto 1fr auto;grid-template-areas:"cov meta" "line line" "prog prog" "ctl ctl" "foot foot";gap:10px 14px;background:linear-gradient(180deg,rgb(8 7 11 / 0) 30%,rgb(8 7 11 / .55))}
.cov{grid-area:cov;position:relative;width:148px;height:148px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,rgb(var(--c1)),rgb(var(--c4)));box-shadow:0 18px 40px -18px rgb(0 0 0 / .9),0 0 0 1px rgb(255 255 255 / .1);display:grid;place-items:center}
.cov img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cov img[hidden]{display:none}
.cov img:not([hidden]) ~ b{display:none}
.cov b{font:italic 400 34px/1 var(--serif);opacity:.85}
.meta{grid-area:meta;min-width:0;align-self:center}
.ttl{margin:0;font:400 23px/1.15 var(--serif);letter-spacing:-.01em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.art{color:var(--muted);font-size:13px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line{grid-area:line;min-height:44px;font:italic 400 17px/1.25 var(--serif);color:rgb(255 255 255 / .88);text-shadow:0 0 24px rgb(var(--accent) / .6);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.line.in{animation:ln .5s cubic-bezier(.2,.8,.2,1)}
@keyframes ln{from{opacity:0;transform:translateY(6px)}}
.prog{grid-area:prog;display:flex;align-items:center;gap:10px}
.bar{position:relative;flex:1;height:16px;display:flex;align-items:center;cursor:pointer}
.bar::after{content:'';position:absolute;left:0;right:0;height:3px;border-radius:3px;background:rgb(255 255 255 / .15)}
.bar i{position:absolute;left:0;right:0;height:3px;border-radius:3px;transform-origin:left;transform:scaleX(0);background:rgb(var(--accent));z-index:1}
.tm{font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.ctl{grid-area:ctl;display:flex;align-items:center;justify-content:center;gap:16px}
.ctl button{width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer;padding:0;transition:transform .2s,background .2s,color .2s}
.ctl button:hover{color:var(--text);background:rgb(255 255 255 / .07)}
.ctl button:active{transform:scale(.9)}
.ctl .pp{width:52px;height:52px;background:#fff;color:#08070b;box-shadow:0 12px 30px -10px rgb(var(--accent) / .8)}
.ctl .pp:hover{background:#fff;color:#08070b}
.ctl svg{width:22px;height:22px}
.ctl .pp svg{width:20px;height:20px}
.foot{grid-area:foot;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--faint);min-width:0}
.foot #st{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot #st[data-hint]{color:rgb(var(--accent));font-weight:600}
.foot button{flex:none;border:0;background:none;padding:2px 0;font:inherit;font-weight:600;color:rgb(var(--accent));cursor:pointer}
.foot button:hover{text-decoration:underline}
@media (min-width:640px){
  .rc{padding:22px;grid-template-columns:216px 1fr;grid-template-rows:auto auto auto auto auto;grid-template-areas:"cov meta" "cov line" "cov prog" "cov ctl" "cov foot";align-content:center;gap:8px 24px}
  .cov{width:216px;height:216px;align-self:center}
  .ttl{font-size:26px;line-height:1.1;-webkit-line-clamp:1}
  .line{min-height:44px;font-size:18px}
  .ctl{justify-content:flex-start;gap:12px}
}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style></head><body>
<iframe id="card" title="hum music player" allow="autoplay; encrypted-media; picture-in-picture"></iframe>
<div id="rc" hidden>
<canvas id="aurora"></canvas>
<div class="rc">
  <div class="cov"><img id="cov" alt="" hidden><b>hum</b></div>
  <div class="meta"><h1 class="ttl" id="ttl">hum</h1><div class="art" id="art">Warming up the music</div></div>
  <div class="line" id="line"></div>
  <div class="prog"><div class="bar" id="bar"><i id="fill"></i></div><span class="tm" id="tm">0:00 / 0:00</span></div>
  <div class="ctl">
    <button id="prev" aria-label="Previous"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5.4v13.2a.9.9 0 0 1-1.38.76l-9.9-6.6a.9.9 0 0 1 0-1.52l9.9-6.6A.9.9 0 0 1 19 5.4z"/><rect x="4.4" y="4.5" width="2.6" height="15" rx="1.1"/></svg></button>
    <button id="toggle" class="pp" aria-label="Play or pause"></button>
    <button id="next" aria-label="Next"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.4v13.2a.9.9 0 0 0 1.38.76l9.9-6.6a.9.9 0 0 0 0-1.52l-9.9-6.6A.9.9 0 0 0 5 5.4z"/><rect x="17" y="4.5" width="2.6" height="15" rx="1.1"/></svg></button>
  </div>
  <div class="foot"><span id="st">Starting in your hum tab</span><button id="open" type="button">Open hum</button></div>
</div>
</div>
<script>
${paintSource()}
(function () {
  var ORIGIN = ${JSON.stringify(CARD_ORIGIN)};
  var APP_URL = ${JSON.stringify(APP_URL)};
  var frame = document.getElementById('card');
  var cardId = 'card-' + Math.random().toString(36).slice(2, 10);
  var hostSeq = 0, hostWait = {}, cardSeq = 0, cardWait = {};
  var ready = false, held = [], toolName = '', lastKey = '';
  var started = false, busy = false, again = false, timer = 0, fails = 0;
  var inactive = false, claim = false, quietUntil = 0, done = [];
  var wideH = 260, tallH = 400, lastW = 0, lastH = 0;
  // remote mode: the host will not frame the player, so the music plays in a hum tab
  var rem = false, inited = false, closed = false, lastCmd = null, regKey = null, regTries = 0;

  function post(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
  function ask(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++hostSeq;
      hostWait[id] = { resolve: resolve, reject: reject };
      post({ id: id, method: method, params: params });
      setTimeout(function () { if (hostWait[id]) { delete hostWait[id]; reject(new Error('timeout')); } }, 15000);
    });
  }
  function toCard(cmd, args) {
    return new Promise(function (resolve) {
      var id = ++cardSeq, m = { hum: cmd, id: id };
      for (var k in args) m[k] = args[k];
      cardWait[id] = resolve;
      if (ready) frame.contentWindow.postMessage(m, ORIGIN); else held.push(m);
      setTimeout(function () { if (cardWait[id]) { delete cardWait[id]; resolve({ ok: false, text: 'timeout' }); } }, 25000);
    });
  }
  function unwrap(res) {
    var out = res && res.structuredContent;
    if (!out && res && res.content && res.content[0]) { try { out = JSON.parse(res.content[0].text); } catch (e) {} }
    return out;
  }

  // ---- host ----
  function fromHost(d) {
    if (d.jsonrpc !== '2.0') return;
    if (d.method === undefined && d.id !== undefined) {
      var w = hostWait[d.id];
      if (!w) return;
      delete hostWait[d.id];
      return d.error ? w.reject(new Error(d.error.message || 'error')) : w.resolve(d.result);
    }
    var p = d.params || {};
    if (d.method === 'ui/notifications/tool-input') return run(fromTool(toolName, p.arguments || {}));
    if (d.method === 'ui/notifications/tool-result') return run(p.structuredContent && p.structuredContent.command);
    if (d.method === 'ui/resource-teardown') { if (!rem) toCard('pause'); started = false; closed = true; }
    if (d.id !== undefined && d.method) post({ id: d.id, result: {} });
  }
  function fromTool(name, a) {
    if (name === 'play') return { cmd: 'play', query: a.query };
    if (name === 'station') return { cmd: 'station', mood: a.mood };
    if (name === 'play_playlist') return { cmd: 'playlist', url: a.url };
  }
  // tool-input and tool-result both describe the same command; run it once.
  function run(cmd) {
    if (!cmd || !cmd.cmd) return;
    lastCmd = cmd;
    var key = JSON.stringify(cmd);
    if (key === lastKey) return;
    lastKey = key;
    if (rem) return register();
    var args = {};
    for (var k in cmd) if (k !== 'cmd') args[k] = cmd[k];
    toCard(cmd.cmd, args);
  }
  function size() {
    var w = Math.round(window.innerWidth), h = w >= 640 ? wideH : tallH;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    post({ method: 'ui/notifications/size-changed', params: { width: w, height: h } });
  }

  // ---- card ----
  function fromCard(d) {
    if (rem) return;
    if (d.hum === 'ready') {
      ready = true;
      held.splice(0).forEach(function (m) { frame.contentWindow.postMessage(m, ORIGIN); });
    } else if (d.hum === 'reply' && cardWait[d.id]) {
      cardWait[d.id](d);
      delete cardWait[d.id];
    } else if (d.hum === 'state') kick();
  }

  // ---- sync with the server, through the host ----
  function slim(s) {
    return {
      playing: s.playing, position: s.position, duration: s.duration, volume: s.volume, line: s.line,
      track: s.track && { title: s.track.title, artist: s.track.artist, album: s.track.album },
      upNext: s.upNext, context: s.context
    };
  }
  function sync() {
    if (!started) return;
    if (busy) { again = true; return; }
    busy = true; again = false;
    var sent = [], c = false;
    toCard('snapshot', {}).then(function (r) {
      var st = r && r.state ? slim(r.state) : null;
      // A user pressing play on a card we paused takes the player back.
      if (inactive && st && st.playing && Date.now() > quietUntil) claim = true;
      sent = done.splice(0); c = claim; claim = false;
      return ask('tools/call', { name: 'card_sync', arguments: { cardId: cardId, state: st, done: sent, claim: c } });
    }).then(function (res) {
      fails = 0;
      var out = unwrap(res);
      if (out) apply(out);
    }).catch(function () {
      fails++; done = sent.concat(done); if (c) claim = true;
    }).then(function () {
      busy = false;
      schedule(again ? 60 : fails ? 5000 : inactive ? 4000 : 1000);
    });
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms); }
  function kick() { if (started) busy ? (again = true) : schedule(150); }
  function apply(out) {
    if (out.active === false) {
      if (!inactive) { inactive = true; quietUntil = Date.now() + 2500; toCard('pause', {}); }
    } else inactive = false;
    (out.commands || []).forEach(exec);
  }
  // Let the card settle before confirming, so the server sees the result and not the old state.
  var SETTLE = { next: 2000, prev: 2000, resume: 2000, pause: 500, volume: 500 };
  function exec(c) {
    var args = {};
    for (var k in c) if (k !== 'id' && k !== 'cmd' && k !== 'at') args[k] = c[k];
    toCard(c.cmd, args).then(function () {
      setTimeout(function () { done.push(c.id); kick(); }, SETTLE[c.cmd] || 500);
    });
  }

  // ---- remote card: cover, lyrics and buttons for the player in the hum tab ----
  var $ = function (id) { return document.getElementById(id); };
  var aurora = null;
  var R = { up: true, connected: false, hint: '', error: '', playing: false, pos: 0, t0: 0, dur: 0, lines: [], lk: '', ak: '', key: '', url: APP_URL };
  var holdUntil = 0, rbusy = false, ragain = false, rtimer = 0, rfails = 0, clickSince = 0, lineIdx = -2, lastSec = -1;
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6v14.8a1.1 1.1 0 0 0 1.66.95l12.2-7.4a1.1 1.1 0 0 0 0-1.9L8.66 3.65A1.1 1.1 0 0 0 7 4.6z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/></svg>';
  var fmt = function (n) { n = n || 0; return Math.floor(n / 60) + ':' + ('0' + Math.floor(n % 60)).slice(-2); };

  function enterRemote(why) {
    if (rem) return;
    rem = true;
    var root = document.documentElement;
    root.setAttribute('data-mode', 'remote');
    root.setAttribute('data-why', why);
    root.setAttribute('data-ms', String(Math.round(performance.now())));
    try { frame.removeAttribute('src'); frame.parentNode.removeChild(frame); } catch (e) {}
    $('rc').hidden = false;
    paintPlay();
    if (Aurora) { try { aurora = new Aurora($('aurora')); } catch (e) { aurora = null; } }
    if (!aurora || !aurora.gl) $('aurora').className = 'off';
    if (inited) size();
    requestAnimationFrame(tick);
    paintStatus();
    setTimeout(register, 1200);
    if (inited) startRemote();
  }
  function startRemote() { if (rem && inited && !closed) { register(); rsync(); } }

  // Tell the server this card is a remote, and hand it the play command we were shown.
  function register() {
    if (!rem || !inited || closed) return;
    var key = lastCmd ? JSON.stringify(lastCmd) : '';
    if (regKey !== null && (regKey === key || !key)) return;
    regKey = key;
    ask('tools/call', { name: 'card_fallback', arguments: { cardId: cardId, command: lastCmd } }).catch(function () {
      regKey = null;
      if (++regTries < 5) setTimeout(register, 2000);
    });
  }

  function rsync() {
    if (!rem || !inited || closed) return;
    if (rbusy) { ragain = true; return; }
    rbusy = true; ragain = false;
    ask('tools/call', { name: 'remote_sync', arguments: { cardId: cardId, ak: R.ak, lk: R.lk } }).then(function (res) {
      var o = unwrap(res);
      if (!o) throw new Error('bad reply');
      rfails = 0;
      applyState(o);
    }).catch(function () {
      if (++rfails >= 2) { R.up = false; paintStatus(); }
    }).then(function () {
      rbusy = false;
      rkick(ragain ? 100 : rfails ? 4000 : document.hidden ? 4000 : 1000);
    });
  }
  function rkick(ms) { clearTimeout(rtimer); rtimer = setTimeout(rsync, ms); }

  function applyState(o) {
    R.up = o.up !== false; R.connected = !!o.connected; R.hint = o.hint || ''; R.error = o.error || ''; R.url = o.url || APP_URL;
    if (o.track) {
      var now = performance.now();
      // a button was just pressed; trust it for a moment so the icon does not flicker back
      var playing = now < holdUntil ? R.playing : !!o.playing;
      var changed = o.key !== R.key;
      if (changed) {
        R.key = o.key; R.ak = ''; lineIdx = -2; R.lines = []; R.lk = '';
        $('cov').hidden = true;
        $('ttl').textContent = o.track.title || 'hum';
        $('art').textContent = o.track.artist || '';
      }
      if (now >= holdUntil || changed) { R.pos = o.position; R.t0 = now - (o.age || 0); }
      R.playing = playing; R.dur = o.duration || 0;
      if (o.lyrics) { R.lines = o.lyrics; R.lk = o.lk; lineIdx = -2; }
      if (o.art) { R.ak = o.ak; setCover(o.art); }
      if (aurora) aurora.setPlaying(R.playing);
      paintPlay();
    }
    paintStatus();
  }

  function setCover(uri) {
    var img = $('cov');
    img.src = uri;
    img.hidden = false;
    if (!palette) return;
    palette(uri).then(function (p) {
      if (!p) return;
      if (aurora) aurora.setColors(p.colors);
      var s = $('rc').style;
      s.setProperty('--accent', p.accent.join(' '));
      p.colors.forEach(function (c, i) { s.setProperty('--c' + (i + 1), c.join(' ')); });
    });
  }
  function paintPlay() { $('toggle').innerHTML = R.playing ? PAUSE : PLAY; }
  function paintStatus() {
    var hint = R.hint;
    // browsers hold the sound back in a tab nobody has clicked; only say so once it stays that way
    if (hint === 'click') { clickSince = clickSince || Date.now(); if (Date.now() - clickSince < 2500) hint = ''; } else clickSince = 0;
    var st = $('st'), msg = '';
    if (!R.up) msg = 'Cannot reach hum right now';
    else if (hint === 'waiting') msg = 'Opening your hum tab';
    else if (hint === 'closed') msg = 'Your hum tab is closed';
    else if (hint === 'click') msg = 'Click the hum tab once to start the sound';
    else if (R.error) msg = R.error;
    else if (R.key) msg = R.playing ? 'Playing in your hum tab' : 'Paused in your hum tab';
    else msg = 'Starting in your hum tab';
    st.textContent = msg;
    if (hint === 'click' || hint === 'closed' || !R.up) st.setAttribute('data-hint', ''); else st.removeAttribute('data-hint');
    if (!R.key) $('art').textContent = R.up ? 'Warming up the music' : 'Waiting for hum';
  }
  function curPos() {
    if (!R.key) return 0;
    var p = R.pos + (R.playing ? (performance.now() - R.t0) / 1000 : 0);
    return Math.max(0, R.dur ? Math.min(p, R.dur) : p);
  }
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    var p = curPos();
    $('fill').style.transform = 'scaleX(' + (R.dur ? Math.min(1, p / R.dur) : 0) + ')';
    var sec = Math.floor(p);
    if (sec !== lastSec) { lastSec = sec; $('tm').textContent = fmt(p) + ' / ' + fmt(R.dur); }
    var L = R.lines, i = -1;
    for (var k = 0; k < L.length && L[k].t <= p + 0.15; k++) i = k;
    if (i !== lineIdx) {
      lineIdx = i;
      var el = $('line');
      el.classList.remove('in');
      void el.offsetWidth;
      el.textContent = i >= 0 ? (L[i].text || '♪') : '';
      el.classList.add('in');
      if (aurora && i >= 0) aurora.kick(0.25);
    }
  }

  function command(cmd, extra) {
    var a = { cmd: cmd };
    for (var k in extra) a[k] = extra[k];
    ask('tools/call', { name: 'remote_cmd', arguments: a }).then(function () { rkick(500); }, function () { rkick(2000); });
  }
  function press(cmd, extra) {
    var now = performance.now();
    R.pos = curPos(); R.t0 = now;
    holdUntil = now + 1500;
    if (cmd === 'pause' || cmd === 'resume') {
      R.playing = cmd === 'resume';
      paintPlay();
      if (aurora) aurora.setPlaying(R.playing);
    }
    command(cmd, extra);
  }
  $('toggle').addEventListener('click', function () { press(R.playing ? 'pause' : 'resume'); });
  $('next').addEventListener('click', function () { press('next'); });
  $('prev').addEventListener('click', function () { press('prev'); });
  $('bar').addEventListener('pointerdown', function (e) {
    if (!R.dur) return;
    var r = e.currentTarget.getBoundingClientRect(), s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * R.dur;
    R.pos = s; R.t0 = performance.now();
    holdUntil = R.t0 + 1500;
    command('seek', { seconds: Math.round(s) });
  });
  // target=_blank is blocked in the sandbox, so ask the host to open the link.
  $('open').addEventListener('click', function () {
    var url = R.url || APP_URL;
    ask('ui/open-link', { url: url }).catch(function () { $('open').textContent = url.replace('https://', '').replace('http://', ''); });
  });

  addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (e.source === parent) fromHost(d);
    else if (frame.contentWindow && e.source === frame.contentWindow && e.origin === ORIGIN) fromCard(d);
  });
  addEventListener('resize', size);

  // ---- is the player frame blocked? Chat hosts differ: Claude ignores frameDomains and only
  // lets a card frame 'self', blob: and data:. A blocked frame still fires load, never error.
  document.addEventListener('securitypolicyviolation', function (e) {
    var dir = e.effectiveDirective || e.violatedDirective || '';
    if (/^(frame|child)-src/.test(dir)) enterRemote('csp');
  });
  frame.addEventListener('load', function () {
    // a working player says ready before its load event, so silence after load means it never ran
    setTimeout(function () { if (!ready) enterRemote('silent'); }, 2500);
  });
  setTimeout(function () { if (!ready) enterRemote('timeout'); }, 8000);
  frame.src = ORIGIN + '/widget.html?card=1';

  ask('ui/initialize', { appInfo: { name: 'hum-card', version: ${JSON.stringify(VERSION)} }, appCapabilities: {}, protocolVersion: '2026-01-26' }).then(function (r) {
    var info = r && r.hostContext && r.hostContext.toolInfo;
    toolName = (info && info.tool && info.tool.name) || '';
    post({ method: 'ui/notifications/initialized', params: {} });
    size();
    inited = true;
    // a host that says which frame origins it approved, and not ours, will not run the player
    var sb = r && r.hostCapabilities && r.hostCapabilities.sandbox;
    var fd = sb && sb.csp && sb.csp.frameDomains;
    if (Array.isArray(fd) && fd.indexOf(ORIGIN) < 0) enterRemote('host');
    if (rem) return startRemote();
    started = true;
    schedule(1000);
  }, function () {});
})();
</script></body></html>`;

// ---------- MCP over stdio ----------

let queue = Promise.resolve();
const out = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  // Tell the host its saved tools and card may be stale, so it fetches them again.
  if (method === 'notifications/initialized' && UI) {
    out({ method: 'notifications/tools/list_changed' });
    out({ method: 'notifications/resources/list_changed' });
  }
  if (id === undefined) return; // notifications
  try {
    if (method === 'initialize') {
      const ext = params?.capabilities?.extensions?.[UI_EXT];
      // HUM_UI=0 turns the card off, HUM_UI=1 forces it on for hosts that do not announce support.
      UI = process.env.HUM_UI === '1' || (process.env.HUM_UI !== '0' && Array.isArray(ext?.mimeTypes) && ext.mimeTypes.includes(UI_MIME));
      if (UI) log(`player card on, framing ${CARD_ORIGIN}`);
      return out({
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: UI ? { tools: { listChanged: true }, resources: { listChanged: true } } : { tools: {} },
          serverInfo: { name: 'hum', version: VERSION },
          instructions:
            'hum plays any song for free in the user\'s browser. Use station for background music while working, play for a specific song.' +
            (UI ? ' The player shows up as a card in the chat. If music does not start, tell the user to tap the card once (or to click the hum browser tab once, if the card says so).' : ''),
        },
      });
    }
    if (method === 'ping') return out({ id, result: {} });
    if (method === 'tools/list') return out({ id, result: { tools: toolList() } });
    if (UI && method === 'resources/list')
      return out({ id, result: { resources: [{ uri: UI_URI, name: 'hum player', description: 'The hum music player card.', mimeType: UI_MIME, _meta: UI_RESOURCE_META }] } });
    if (UI && method === 'resources/templates/list') return out({ id, result: { resourceTemplates: [] } });
    if (UI && method === 'resources/read') {
      log(`card requested: ${params?.uri}`);
      // Any hum card address, old or new, gets today's card: a host holding an older tool list
      // still shows the current player.
      if (!/^ui:\/\/hum\/player(-[\w.]+)?$/.test(params?.uri || '')) return out({ id, error: { code: -32002, message: `Resource not found: ${params?.uri}` } });
      return out({ id, result: { contents: [{ uri: params.uri, mimeType: UI_MIME, text: shell(), _meta: UI_RESOURCE_META }] } });
    }
    if (method === 'tools/call') {
      if (!/^(card_sync|remote_sync)$/.test(params?.name)) log(`tool: ${params?.name}`);
      // The card's own calls must never wait behind a control call that is waiting for them.
      const appTool = { card_sync: cardSync, card_fallback: cardFallback, remote_sync: remoteSync, remote_cmd: remoteCmd }[params.name];
      if (appTool) {
        try {
          const r = await appTool(params.arguments);
          return out({ id, result: { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r } });
        } catch (e) {
          return out({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
        }
      }
      try {
        // One at a time, so "play X" then "pause" land in that order.
        const run = queue.then(() => callTool(params.name, params.arguments));
        queue = run.catch(() => {});
        const reply = await run;
        return out({ id, result: typeof reply === 'string' ? { content: [{ type: 'text', text: reply }] } : reply });
      } catch (e) {
        return out({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    out({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    out({ id, error: { code: -32603, message: e.message } });
  }
});
