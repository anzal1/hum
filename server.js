// Local server with zero dependencies. `node server.js` and open the printed URL.
// Besides the app it runs a tiny remote-control hub so agents, scripts and the
// MCP server can drive whichever hum window was opened last.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlers } from './api/_core.js';
import { SYNC_MAX, syncId } from './api/sync.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// ---------- remote hub ----------

const clients = [];
const pending = new Map();
let state = null;
let seq = 0;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function command(msg, timeout = 20000) {
  const client = clients.at(-1);
  if (!client) return Promise.resolve({ ok: false, text: 'No hum window is open.' });
  const id = ++seq;
  client.write(`data: ${JSON.stringify({ ...msg, id })}\n\n`);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => pending.has(id) && (pending.delete(id), resolve({ ok: false, text: 'The hum window did not answer.' })), timeout);
  });
}
export const remote = { command, get state() { return state; }, get connected() { return clients.length; } };

async function remoteRoute(req, res, path) {
  if (path === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    clients.push(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      clients.splice(clients.indexOf(res), 1);
    });
    return;
  }
  if (path === 'state' && req.method === 'GET') return send(res, 200, { connected: clients.length, ...(state || {}) });
  // JSON only. Browsers must preflight a cross-site JSON POST, and we never approve
  // one, so random websites cannot press play on your machine.
  if (req.method !== 'POST' || !String(req.headers['content-type']).includes('application/json')) return send(res, 415, { error: 'POST JSON' });
  const body = await readJson(req).catch(() => null);
  if (!body) return send(res, 400, { error: 'Bad JSON' });
  if (path === 'state') return (state = body), send(res, 200, { ok: true });
  if (path === 'reply') {
    pending.get(body.id)?.(body);
    pending.delete(body.id);
    return send(res, 200, { ok: true });
  }
  if (path === '') return send(res, 200, await command(body));
  send(res, 404, { error: 'Not found' });
}

// ---------- sync proxy ----------

// The local hum has no database. It forwards sync calls to the website (or HUM_SYNC_URL),
// so both share one encrypted library. HUM_SYNC=off turns it off. The data stays ciphertext.
const syncBase = (() => {
  const u = (process.env.HUM_SYNC_URL || 'https://hum.anzalabidi.dev/api/sync').replace(/\/+$/, '');
  return u.includes('/api/sync') ? u : `${u}/api/sync`;
})();
const syncOff = /^(off|0|false|no)$/i.test(process.env.HUM_SYNC || '');
const passHeaders = ['x-sync-version', 'x-sync-updated', 'retry-after'];

async function syncRoute(req, res, url) {
  if (syncOff) return send(res, 501, { error: 'Sync is turned off (HUM_SYNC=off)' });
  const id = url.pathname.replace(/^\/api\/sync\/?/, '');
  if (id && !syncId(id)) return send(res, 400, { error: 'Bad sync id' });
  if (!['GET', 'PUT'].includes(req.method)) return send(res, 405, { error: 'GET or PUT only' });
  let body;
  if (req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > SYNC_MAX) return send(res, 413, { error: `Too big. The limit is ${SYNC_MAX / 1024} KB` });
      chunks.push(c);
    }
    body = Buffer.concat(chunks);
  }
  try {
    const target = `${syncBase}${id ? `/${id}` : ''}${id && url.searchParams.has('since') ? `?since=${encodeURIComponent(url.searchParams.get('since'))}` : ''}`;
    const up = await fetch(target, {
      method: req.method,
      headers: { ...(body && { 'Content-Type': 'application/octet-stream', 'X-Sync-Base': String(req.headers['x-sync-base'] || '') }), 'User-Agent': 'hum-local' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const out = { 'Cache-Control': 'no-store', 'Content-Type': up.headers.get('content-type') || 'application/octet-stream' };
    for (const h of passHeaders) up.headers.get(h) && (out[h] = up.headers.get(h));
    res.writeHead(up.status, out);
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch {
    send(res, 502, { error: 'Could not reach the sync server' });
  }
}

// ---------- http ----------

export function startServer({ port = Number(process.env.PORT) || 3737, host = process.env.HOST || '127.0.0.1', log = console.log } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rem = url.pathname.match(/^\/api\/remote\/?(\w*)$/);
    // Remote control is for your own machine only, even when hum is served to a network (Docker).
    if (rem && !/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) return send(res, 403, { error: 'Remote control is local only' });
    if (rem) return remoteRoute(req, res, rem[1]);
    if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) return syncRoute(req, res, url);
    const shared = url.pathname.match(/^\/s\/([\w-]{11})$/);
    if (shared) url.pathname = '/api/share', url.searchParams.set('id', shared[1]);
    const api = url.pathname.match(/^\/api\/(\w+)$/);
    if (api && handlers[api[1]]) {
      const out = await handlers[api[1]](new Request(url));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(await out.text());
    }
    const path = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`hum is playing at http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
