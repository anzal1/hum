#!/usr/bin/env node
// hum as an MCP server, so any coding agent can play music while you work.
//   claude mcp add hum -- node /path/to/hum/mcp.js
// Zero dependencies. Speaks MCP over stdio, starts the local hum server if needed,
// and opens hum in your browser the first time music is asked for.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { startServer } from './server.js';

const PORT = Number(process.env.HUM_PORT) || 3737;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_URL = `http://localhost:${PORT}`;
const log = (...a) => console.error('[hum]', ...a);

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

async function callTool(name, args = {}) {
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
    if (method === 'initialize')
      return out({
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'hum', version: '0.1.0' },
          instructions: 'hum plays any song for free in the user\'s browser. Use station for background music while working, play for a specific song.',
        },
      });
    if (method === 'ping') return out({ id, result: {} });
    if (method === 'tools/list') return out({ id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try {
        // One at a time, so "play X" then "pause" land in that order.
        const run = queue.then(() => callTool(params.name, params.arguments));
        queue = run.catch(() => {});
        const text = await run;
        return out({ id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return out({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    out({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    out({ id, error: { code: -32603, message: e.message } });
  }
});
