// `hum now`: show what is playing. Never starts the server or opens anything.
//   hum now          a few lines for people
//   hum now --json   the remote state, with position and line brought up to date
//   hum now --line   one short line for tmux, shell prompts and Claude Code's statusLine
import { getState } from './remote.js';

const fmt = (n) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

// Where the song is right now, given that the window reported a moment ago.
function livePosition(s) {
  const away = s.playing && s.at ? Math.min(60, Math.max(0, (Date.now() - s.at) / 1000)) : 0;
  const pos = (s.position || 0) + away;
  return s.duration ? Math.min(pos, s.duration) : pos;
}

// The last synced lyric at or before the position (same rule the app uses).
function lyricAt(s, pos) {
  let line = '';
  if (!s.lyrics?.length) return clean(s.line);
  for (const l of s.lyrics) if (l.t <= pos + 0.15) line = l.text; else break;
  return clean(line);
}

const clip = (s, n) => (n <= 0 ? '' : [...s].length <= n ? s : `${[...s].slice(0, Math.max(0, n - 1)).join('').trimEnd()}…`);

function statusLine(s, pos, width) {
  const head = [clean(s.track.title), clean(s.track.artist)].filter(Boolean).join(' · ');
  const icon = s.playing ? '♪' : '❚❚';
  const lyric = lyricAt(s, pos);
  const base = `${icon} ${head}`;
  const room = width - [...base].length - 3; // room left for " · " plus the lyric
  if (lyric && room >= 12) return `${base} · ${clip(lyric, room)}`;
  return clip(base, width);
}

function pretty(s, pos) {
  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const dim = (t) => (tty ? `\x1b[2m${t}\x1b[0m` : t);
  const bold = (t) => (tty ? `\x1b[1m${t}\x1b[0m` : t);
  const t = s.track;
  const cells = 24;
  const filled = s.duration ? Math.min(cells, Math.round((pos / s.duration) * cells)) : 0;
  const bar = '━'.repeat(filled) + dim('─'.repeat(cells - filled));
  const lines = [
    `${s.playing ? '♪' : '❚❚'} ${bold(clean(t.title))}`,
    `  ${clean(t.artist)}${t.album && t.album !== t.title ? dim(` · ${clean(t.album)}`) : ''}`,
    `  ${fmt(pos)} ${bar} ${fmt(s.duration)}  ${dim(`vol ${s.volume}%${s.ducked ? ' (ducked)' : ''}`)}`,
  ];
  const lyric = lyricAt(s, pos);
  if (lyric) lines.push(`  ${lyric}`);
  return lines.join('\n');
}

export async function now(args) {
  const line = args.includes('--line');
  const json = args.includes('--json');
  // Short timeout for status bars. A dead port refuses at once, so this only
  // matters if something else answers slowly.
  const s = await getState(line ? 120 : 1500);

  if (line) {
    if (s?.connected && s.track) {
      const width = process.stdout.isTTY ? (process.stdout.columns || 101) - 1 : 100; // leave the last column free
      console.log(statusLine(s, livePosition(s), width));
    }
    return 0;
  }
  if (!s) {
    if (json) console.log(JSON.stringify({ connected: 0 }));
    else console.error('hum is not running.');
    return 1;
  }
  const pos = livePosition(s);
  if (json) {
    console.log(JSON.stringify({ ...s, position: Math.round(pos * 10) / 10, line: lyricAt(s, pos) }));
    return s.connected ? 0 : 1;
  }
  if (!s.connected) return console.error('hum is running but no window is open.'), 1;
  console.log(s.track ? pretty(s, pos) : 'Nothing is playing.');
  return 0;
}
