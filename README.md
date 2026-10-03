# hum

Every song ever made, free, in a player that feels like a room lit by the album cover.

- Search any song, or paste a Spotify playlist, album or track link (or press ⌘V anywhere).
- Tap a station and it plays forever in that mood.
- Time-synced lyrics, an endless autoplay mix, liked songs, shareable song links.
- No accounts, no keys, no database. Your library lives in your browser.

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

`test/e2e.js` is an end-to-end suite of 87 checks covering every search path, button, slider, switch, list action, keyboard shortcut, the widget, share pages, the remote and the For you taste rules. The suite passes in Chromium; the first 52 checks also passed in Firefox and WebKit (Safari's engine) when they were written. Serve it next to the app (`cp test/e2e.js public/__e2e.js`), start the app, press play once, then run in the console:

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
