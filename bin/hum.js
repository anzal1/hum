#!/usr/bin/env node
// `hum` with no arguments starts hum and opens it in the browser (`npx github:<you>/hum`).
// With a subcommand it is a remote for a running hum: `hum play ...`, `hum now`, `hum help`.
const USAGE = `hum: free music from your terminal

  hum                     start hum and open it in the browser
  hum play <words>        play a song ("hum play blinding lights")
  hum station <mood>      endless mix ("hum station lofi beats")
  hum playlist <url>      play a Spotify playlist, album or track link
  hum pause | resume | toggle | next | prev
  hum vol <0-100>         set the volume
  hum duck [percent]      lower the music (default 30), hum unduck to restore
  hum now                 what is playing (--json for scripts, --line for status bars)

Needs a hum window to play. Playback commands start hum and open it if needed.
Set HUM_PORT to use another port, HUM_NO_OPEN=1 to never open the browser.`;

const PLAYBACK = new Set(['play', 'station', 'playlist', 'resume', 'toggle', 'next', 'prev']);
const ALIASES = { vol: 'volume', skip: 'next', previous: 'prev', back: 'prev' };

async function run(name, args) {
  if (['help', '-h', '--help'].includes(name)) return console.log(USAGE), 0;
  const c = ALIASES[name] || name;
  if (c === 'now') return (await import('./now.js')).now(args);
  if (!['play', 'station', 'playlist', 'pause', 'resume', 'toggle', 'next', 'prev', 'volume', 'duck', 'unduck'].includes(c)) {
    console.error(`Unknown command "${name}".\n\n${USAGE}`);
    return 2;
  }

  const msg = build(c, args);
  if (typeof msg === 'string') return console.error(msg), 2;

  const { getState, ensureWindow, send, sleep } = await import('./remote.js');
  let opened = false;
  if (PLAYBACK.has(c)) {
    try {
      ({ opened } = await ensureWindow((t) => console.error(t)));
    } catch (e) {
      return console.error(e.message), 1;
    }
  } else if (!(await getState())) {
    return console.error('hum is not running.'), 1;
  }

  let reply;
  try {
    reply = await send(msg);
  } catch {
    return console.error('hum did not answer.'), 1;
  }
  (reply.ok ? console.log : console.error)(reply.text);
  if (!reply.ok) return 1;

  // A freshly opened tab may hold the sound until it gets one click.
  if (opened && ['play', 'station', 'playlist'].includes(c)) {
    await sleep(2500);
    const s = await getState();
    if (s?.track && !s.playing) console.error('The browser is holding the sound until you click the hum tab once. After that it plays on its own.');
  }
  return 0;
}

// Turn the command line into a remote message, or return a usage error string.
function build(c, args) {
  const text = args.join(' ').trim();
  switch (c) {
    case 'play': return text ? { cmd: 'play', query: text } : 'Usage: hum play <song or artist>';
    case 'station': return text ? { cmd: 'station', mood: text } : 'Usage: hum station <mood, genre or artist>';
    case 'playlist': return /^https?:\/\//.test(text) ? { cmd: 'playlist', url: text } : 'Usage: hum playlist <open.spotify.com link>';
    case 'volume': {
      const n = Number(text.replace('%', ''));
      if (!text || !Number.isFinite(n) || n < 0 || n > 100) return 'Usage: hum vol <0-100>';
      // The app reads 0-1 as a fraction, so nudge a literal 1 to mean 1 percent.
      return { cmd: 'volume', level: n };
    }
    case 'duck': {
      if (!text) return { cmd: 'duck' };
      const n = Number(text.replace('%', ''));
      return Number.isFinite(n) && n >= 0 && n <= 100 ? { cmd: 'duck', level: n } : 'Usage: hum duck [percent of current volume]';
    }
    default: return { cmd: c };
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  const { spawn } = await import('node:child_process');
  const { startServer } = await import('../server.js');
  const port = Number(process.env.PORT) || 3737;
  await startServer({ port });
  if (!process.env.HUM_NO_OPEN && process.stdout.isTTY) {
    const url = `http://localhost:${port}`;
    const [c, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
} else {
  process.exitCode = await run(cmd, args);
}
