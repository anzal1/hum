# hum

Every song ever made, free, in a player that feels like a room lit by the album cover.

- Search any song, or paste a Spotify playlist, album or track link (or press ⌘V anywhere).
- Tap a station and it plays forever in that mood.
- Time-synced lyrics, an endless autoplay mix, liked songs, shareable song links.
- No accounts and no keys. Your library lives in your browser, and [sync](#sync-your-library) can carry it between devices without an account.

Playback runs through YouTube's official embedded player, so ads and royalties work the normal way and artists still get paid.

## Run it

**One command** (Node 18+). Starts hum and opens it in your browser:

```bash
npx github:anzal1/hum
```

**From a clone:**

```bash
node server.js
```

**Docker** (home server, VPS, NAS):

```bash
docker build -t hum . && docker run -p 3737:3737 hum
```

## Put it online for free

hum is a folder of static files plus one small function, so it fits the free tier of Cloudflare Workers: static files are unlimited and 100,000 searches a day are included.

- **One click:** the Deploy to Cloudflare button on `/developers.html`, or `https://deploy.workers.cloudflare.com/?url=https://github.com/anzal1/hum`
- **From this folder:** `npx wrangler deploy`

Vercel works too (`api/` and `vercel.json` are ready), but its free plan is for non-commercial use.

Tested: `node server.js`, `npx` from a packed tarball, Docker, and Cloudflare's own runtime locally (`npx wrangler dev`). Every route answered in all four.

## Sync your library

Your likes, playlists and history normally live in one browser, so clearing site data loses them and a second device starts empty. Sync fixes that without an account, an email or a login.

**Use it.** Open the home page, find **Your library**, press **Sync**, then **Turn on sync**. You get a code like `W6R1-BA1V-1BME-RGNM-GRTQ-X2PG-J8EG` and a copy button. On another device (or the local hum), press **Sync**, **Use a sync code**, and type it in. A typo is caught by a checksum before anything happens. **Turn off sync** stops it on that device and keeps your library there. **Export library** and **Import** in the same panel make a JSON backup you can restore anywhere; importing adds to what you have and never replaces it.

**What syncs.** `liked`, `playlists`, `recent`, and the `taste` and `variants` values when they exist. Volume, shuffle, the current queue and layout stay per device.

**How it works.**

- The code is 128 random bits (plus an 8-bit checksum), made in your browser.
- WebCrypto turns it into two unrelated things with HKDF: a record id and an AES-256-GCM key. The key never leaves the page.
- The library is compressed, encrypted, and sent as one blob. The server sees the id, the ciphertext, its size and when it changed. It never sees the code, the key or a single song name. The blob is also bound to its id, so it cannot be swapped under another one.
- Pulling merges instead of overwriting: likes and playlists are unioned, the newest edit of a playlist wins, a removal travels as a tombstone so it is not undone by a device that still has the old copy, history merges by play time (30 kept), and `taste` takes the max of every counter and timestamp. Local data is never dropped to make room for remote data.
- Pushes wait about 5 seconds after a change and go out at most once per 30 seconds. hum pulls on load, on focus and every minute while visible, never more than once a minute. Each write names the version it was based on; if another device got there first, hum pulls, merges and retries.

**Privacy and limits.**

- Anyone who has the code can read and change your library, and nobody can recover a lost code. Keep it in a password manager.
- The code is stored in your browser's localStorage (key `hum:sync`) so sync can run, so anyone with access to your browser profile has it. Turning sync off removes it.
- Turning sync off does not delete the encrypted copy on the server. Without the code it is unreadable noise.
- The server can see that an id exists and when it was written. It could refuse service or serve you an older ciphertext, but it cannot read or forge your data.
- The blob is capped at 512 KB (roughly 5,000 liked songs, since it is compressed), and the server accepts one write per id every 10 seconds.

**The local hum and the website share one library.** They are different origins, so they cannot share browser storage, but the local server (`node server.js`, `npx github:anzal1/hum`) forwards `/api/sync` to `https://hum.anzalabidi.dev/api/sync` by default. Enter the same code in both and they stay in step. Only ciphertext passes through the proxy.

| Variable | Does |
| --- | --- |
| `HUM_SYNC_URL` | Sync server to forward to, for example your own Worker: `https://hum.you.workers.dev/api/sync`. |
| `HUM_SYNC=off` | No sync from this local server. The panel then offers only Export and Import. |

**Self-hosting sync on Cloudflare D1.** Sync needs a D1 database bound as `SYNC`. Without one the routes answer `501` and the page offers only Export and Import, and everything else works as before.

```bash
npx wrangler d1 create hum-sync                      # copy the database_id it prints
# add to wrangler.jsonc, at the top level:
#   "d1_databases": [{ "binding": "SYNC", "database_name": "hum-sync", "database_id": "<yours>", "migrations_dir": "migrations" }]
npx wrangler d1 migrations apply hum-sync --remote
npx wrangler deploy
```

The block under `env.production` is the official site's database; leave it or replace it with yours. To try it locally: `npx wrangler d1 migrations apply hum-sync --local && npx wrangler dev --local`. The table is one row per library: `blobs(id, data, version, updated)` in `migrations/0001_blobs.sql`.

## Put hum inside your app

One script tag adds a floating player to any page:

```html
<script src="https://YOUR-HUM-HOST/embed.js" data-station="lofi beats"></script>
```

Then drive it from code: `hum.play('Blinding Lights')`, `hum.station('deep focus')`, `hum.playlist(spotifyUrl)`, `hum.pause()`, `hum.next()`, `hum.volume(60)`, `hum.on('state', fn)`. Or use the iframe directly: `widget.html?station=lofi` and `postMessage({ hum: 'play', query })`. Live demo at `/developers.html`.

## In your coding agent

hum works with any agent that speaks MCP. Your agent is the remote, and the music plays in a hum browser tab. It can play, start a station, import a Spotify link, skip, set the volume, and tell you what is playing, down to the line being sung. Needs Node 18+.

```bash
claude mcp add --scope user hum -- npx -y -p github:anzal1/hum hum-mcp
```

VS Code:

```bash
code --add-mcp '{"name":"hum","type":"stdio","command":"npx","args":["-y","-p","github:anzal1/hum","hum-mcp"]}'
```

Claude Desktop (one-click extension), Cursor (install link), Codex, Gemini CLI, Windsurf, Zed, Copilot CLI, opencode, Cline, Kiro, Amp, Goose and Continue are all in [docs/agents.md](docs/agents.md).

## From your terminal

Install once, and the commands start hum and open it for you when needed.

```bash
npm i -g github:anzal1/hum

hum play blinding lights       # a song or artist
hum station lofi beats         # an endless mix
hum playlist <spotify link>
hum pause | resume | toggle | next | prev
hum vol 40
hum duck                       # lower the music; hum unduck brings it back
hum now                        # title, artist, progress and the line being sung
```

`hum now --line` prints one short line for status bars, and nothing when hum is not running: `♪ Amazing Grace · Judy Collins · I once was lost, but now I am found`. It never starts hum and returns in about 30 ms. `hum now --json` is for scripts.

In tmux (`~/.tmux.conf`):

```
set -g status-right '#(hum now --line)'
set -g status-interval 2
```

In Claude Code (`~/.claude/settings.json`):

```json
"statusLine": { "type": "command", "command": "hum now --line" }
```

Anything else can POST to the local remote, which only listens on 127.0.0.1 and only accepts JSON:

```bash
curl -X POST localhost:3737/api/remote -H 'content-type: application/json' -d '{"cmd":"station","mood":"lofi"}'
```

Playback always happens in the hum window, through YouTube's own player, so keep it open. The terminal is a remote and a display. `HUM_PORT` picks another port and `HUM_NO_OPEN=1` stops it opening the browser.

## How it works

| Piece | Source |
| --- | --- |
| Search, song metadata, autoplay mixes | YouTube Music's public web API, called from `api/_core.js` |
| Playback | YouTube IFrame Player API, always visible as the rules require |
| Lyrics | [LRCLIB](https://lrclib.net), called straight from the browser |
| Spotify import | Spotify's public embed page for that playlist |
| Colours | Pulled from the cover art in the browser, painted with a WebGL shader |

If a song's main upload refuses to play outside YouTube, hum quietly tries the next best upload.

## Desktop app with a live notch

`desktop/` is a small Electron app: hum in its own window, plus an island that sits over the MacBook notch. The compact island wraps the notch (cover on the left, bars on the right); hover it and it drops down into a mini player with the lyric being sung, progress and controls. On Windows and on Macs without a notch it floats at the top centre of the screen. The island talks to the player over a `BroadcastChannel`, so any window of the same site can drive it.

```bash
cd desktop && npm install && npm start          # uses https://hum.anzalabidi.dev
cd desktop && npm run dev                       # uses your local server on :3737
```

In the browser, press `N` for the same island inside the page.

## Pop-out mini player

Press `P` or the pop-out button and the player moves into a small always-on-top window (Chrome and Edge, via Document Picture-in-Picture). Chrome can also open it by itself when you switch tabs mid-song. Close it and playback slides back into the page at the same second.

## For you

Every playlist you bring over and every station has an Original / For you switch. For you keeps the same songs but ranks them by what you finish, skip and like, and weaves in a few finds from outside the playlist, tagged "new for you". It opens with 3 finds, adds up to 3 on each new day you open it, and never goes past 30% of the list. A find you skip twice is retired for good. Once you have played a handful of songs, the home page adds a "Made for you" row with the variants of what you play most.

Everything is computed in the browser from your own listening and stored in `localStorage` under the keys `taste` and `variants`. Your taste data stays on your device; the only requests are the ordinary radio lookups for a few of your songs that find new ones. The rules live in `public/taste.js`.

## Share links

Song links look like `/s/<id>`. Chat apps and social sites see the song's own cover and title; people who click land straight in the player. The default preview image is `public/og.jpg`, made from `og/og.html`. Set the `og:image` in `public/index.html` to your full domain after deploying, since some crawlers ignore relative paths.

## Tests

`test/e2e.js` is an end-to-end suite of 100 checks covering every search path, button, slider, switch, list action, keyboard shortcut, the widget, share pages, the remote, the For you taste rules and sync (key derivation, encrypt and decrypt, a wrong code failing, every merge rule, and two devices converging through a fake server). It passes in Chromium; the first 52 checks also passed in Firefox and WebKit (Safari's engine) when they were written. Serve it next to the app (`cp test/e2e.js public/__e2e.js`), start the app, press play once, then run in the console:

```js
(await import('/__e2e.js')).run().then((r) => console.table(r))
```

## Keys

| Key | Does |
| --- | --- |
| `/` or `⌘K` | Search |
| `Space` | Play or pause |
| `←` `→` | Seek 5s |
| `Shift` + `←` `→` | Previous or next |
| `L` | Lyrics |
| `Q` | Up next |
| `S` | Shuffle |
| `M` | Mute |
| `P` | Pop out the mini player |
| `N` | Notch mode |

## Limits worth knowing

- YouTube's rules say the player must stay visible and can't play in the background, so music stops when a phone locks. Desktop, tablets and TVs are fine.
- Spotify import brings over the first 100 songs of a playlist.
- Search and mixes use YouTube Music's unofficial web API, which can change without notice.
- YouTube may show ads in the player. hum does not and should not block them. People signed in to YouTube Premium in the same browser usually get no ads.
- A fresh tab needs one click before the browser allows sound. After that, agents and the widget API play freely.
