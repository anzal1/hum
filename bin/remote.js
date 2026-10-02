// Shared by the hum terminal commands: talk to the local server, start it if it is
// not running, and open a hum window when none is connected. Zero dependencies.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.HUM_PORT) || Number(process.env.PORT) || 3737;
export const APP_URL = `http://localhost:${PORT}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function call(method, path, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = body && JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, timeout, headers, agent: false }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

// The remote state, or null when hum is not running on this port.
export async function getState(timeout = 1500) {
  try {
    const s = await call('GET', '/api/remote/state', null, timeout);
    return typeof s?.connected === 'number' ? s : null;
  } catch {
    return null;
  }
}

export const send = (msg) => call('POST', '/api/remote', msg, 30000);

export function openBrowser(url = APP_URL) {
  if (process.env.HUM_NO_OPEN) return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// Start the server in the background so it outlives this command.
function spawnServer() {
  const entry = fileURLToPath(new URL('./serve.js', import.meta.url));
  const env = { ...process.env, PORT: String(PORT), HUM_PORT: String(PORT) };
  spawn(process.execPath, [entry], { stdio: 'ignore', detached: true, env }).on('error', () => {}).unref();
}

// Make sure the server is up and a hum window is listening.
// Returns { state, opened } or throws with a message that is fine to print.
export async function ensureWindow(say = () => {}) {
  let state = await getState();
  if (!state) {
    spawnServer();
    for (let i = 0; i < 40 && !state; i++) {
      await sleep(150);
      state = await getState();
    }
    if (!state) throw new Error(`Could not start hum on port ${PORT}. Is something else using it?`);
  }
  if (state.connected) return { state, opened: false };
  say(process.env.HUM_NO_OPEN ? `Waiting for a hum window. Open ${APP_URL} to connect.` : 'Opening hum in your browser...');
  openBrowser();
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    state = await getState();
    if (state?.connected) return { state, opened: true };
  }
  throw new Error(`Could not reach a hum window. Open ${APP_URL} in your browser and try again.`);
}
