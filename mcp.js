#!/usr/bin/env node
// hum as an MCP server, so any coding agent can play music while you work.
//   claude mcp add hum -- node /path/to/hum/mcp.js
// Zero dependencies. Speaks MCP over stdio, starts the local hum server if needed,
// and opens hum in your browser the first time music is asked for.
// Hosts that support MCP Apps (Claude, ChatGPT, VS Code) get hum's real player as a
// card inside the chat instead. Every other host keeps the browser tab.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { startServer } from './server.js';

const PORT = Number(process.env.HUM_PORT) || 3737;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_URL = `http://localhost:${PORT}`;
const log = (...a) => console.error('[hum]', ...a);

// ---------- player card (MCP Apps) ----------

const UI_URI = 'ui://hum/player';
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
const toolList = () => (UI ? [...TOOLS.map((t) => (SHOW_CARD.has(t.name) ? { ...t, _meta: CARD_META } : t)), CARD_SYNC] : TOOLS);

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
  while (expectSince && Date.now() - expectSince < 20000 && !(cardLive() && card.since >= expectSince) && Date.now() < until) await nextSync(500);
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
const serverUp = () => fetch(`${BASE}/api/remote/state`).then((r) => r.ok, () => false);

// With a card on screen, play tools just hand the command to the card.
function startOnCard(name, args) {
  const q = String(args.query ?? args.mood ?? args.url ?? '').trim();
  if (!q) throw new Error(`${name} needs a ${name === 'play' ? 'query' : name === 'station' ? 'mood' : 'url'}`);
  const command =
    name === 'play' ? { cmd: 'play', query: q } : name === 'station' ? { cmd: 'station', mood: q } : { cmd: 'playlist', url: q };
  expectSince = Date.now();
  const what = name === 'play' ? `“${q}”` : name === 'station' ? `a ${q} station` : 'that playlist';
  return {
    content: [{ type: 'text', text: `Playing ${what} on the hum card above. If the player asks, tap the card once to let the browser play sound.` }],
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
  if (UI && SHOW_CARD.has(name)) return startOnCard(name, args);
  if (UI && ['now_playing', 'control', 'volume'].includes(name)) {
    const reply = await onCard(name, args);
    if (reply != null) return reply;
    // No card is reporting in. Use a hum browser tab if one is open, but never start one for this.
    if (!(await serverUp()) || !(await getState()).connected) return NO_PLAYER;
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

// ---------- the view the host shows ----------
// A thin shell. It frames hum's own widget (so YouTube sees a real page and referrer),
// talks MCP Apps to the host, and relays between the host and the widget's postMessage API.

const shell = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>hum</title>
<style>
html,body{margin:0;height:100%;background:#08070b;overflow:hidden;font:13px system-ui,sans-serif}
iframe{display:block;width:100%;height:100%;border:0}
#err{position:fixed;inset:0;display:none;place-content:center;padding:24px;text-align:center;color:#f6f2ec;background:#08070b}
#err a{color:#ffc496}
</style></head><body>
<iframe id="card" title="hum music player" allow="autoplay; encrypted-media; picture-in-picture"></iframe>
<div id="err">The hum player could not load.<br><a href="${CARD_ORIGIN}" target="_blank" rel="noopener">Open hum</a></div>
<script>
(function () {
  var ORIGIN = ${JSON.stringify(CARD_ORIGIN)};
  var frame = document.getElementById('card');
  var cardId = 'card-' + Math.random().toString(36).slice(2, 10);
  var hostSeq = 0, hostWait = {}, cardSeq = 0, cardWait = {};
  var ready = false, held = [], toolName = '', lastKey = '';
  var started = false, busy = false, again = false, timer = 0, fails = 0;
  var inactive = false, claim = false, quietUntil = 0, done = [];
  var wideH = 260, tallH = 400, lastW = 0, lastH = 0;

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
    if (d.method === 'ui/resource-teardown') { toCard('pause'); started = false; }
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
    var key = JSON.stringify(cmd);
    if (key === lastKey) return;
    lastKey = key;
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
      var out = res && res.structuredContent;
      if (!out && res && res.content && res.content[0]) { try { out = JSON.parse(res.content[0].text); } catch (e) {} }
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

  addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (e.source === parent) fromHost(d);
    else if (e.source === frame.contentWindow && e.origin === ORIGIN) fromCard(d);
  });
  addEventListener('resize', size);

  frame.src = ORIGIN + '/widget.html?card=1';
  setTimeout(function () { if (!ready) document.getElementById('err').style.display = 'grid'; }, 20000);
  ask('ui/initialize', { appInfo: { name: 'hum-card', version: '0.2.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' }).then(function (r) {
    var info = r && r.hostContext && r.hostContext.toolInfo;
    toolName = (info && info.tool && info.tool.name) || '';
    post({ method: 'ui/notifications/initialized', params: {} });
    size();
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
          capabilities: UI ? { tools: {}, resources: {} } : { tools: {} },
          serverInfo: { name: 'hum', version: '0.2.0' },
          instructions:
            'hum plays any song for free in the user\'s browser. Use station for background music while working, play for a specific song.' +
            (UI ? ' The player shows up as a card in the chat. If music does not start, tell the user to tap the card once.' : ''),
        },
      });
    }
    if (method === 'ping') return out({ id, result: {} });
    if (method === 'tools/list') return out({ id, result: { tools: toolList() } });
    if (UI && method === 'resources/list')
      return out({ id, result: { resources: [{ uri: UI_URI, name: 'hum player', description: 'The hum music player card.', mimeType: UI_MIME, _meta: UI_RESOURCE_META }] } });
    if (UI && method === 'resources/templates/list') return out({ id, result: { resourceTemplates: [] } });
    if (UI && method === 'resources/read') {
      if (params?.uri !== UI_URI) return out({ id, error: { code: -32002, message: `Resource not found: ${params?.uri}` } });
      return out({ id, result: { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: shell(), _meta: UI_RESOURCE_META }] } });
    }
    if (method === 'tools/call') {
      // The card's own sync must never wait behind a control call that is waiting for it.
      if (params.name === 'card_sync') {
        try {
          const r = cardSync(params.arguments);
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
