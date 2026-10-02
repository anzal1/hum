#!/usr/bin/env node
// `npx github:<you>/hum` lands here: start hum and open it in the browser.
import { spawn } from 'node:child_process';
import { startServer } from '../server.js';

const port = Number(process.env.PORT) || 3737;
await startServer({ port });
if (!process.env.HUM_NO_OPEN && process.stdout.isTTY) {
  const url = `http://localhost:${port}`;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
