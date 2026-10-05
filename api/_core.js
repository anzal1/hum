// Shared server logic. Every handler is a plain Web `Request -> Response`
// function so the same code runs on Vercel, Cloudflare and the local server.

const YTM = 'https://music.youtube.com/youtubei/v1/';
const YT = 'https://www.youtube.com/youtubei/v1/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

// Identical upstream work already in flight inside this isolate is shared, so a burst of
// the same search or radio asks YouTube once. The map empties itself when the call settles.
const inflight = new Map();
function coalesce(key, make) {
  let p = inflight.get(key);
  if (!p) {
    p = Promise.resolve().then(make).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const innertube = (base, endpoint, client, body) =>
  coalesce(`${base}${endpoint}|${JSON.stringify(body)}`, () => innertubeCall(base, endpoint, client, body));

async function innertubeCall(base, endpoint, client, body) {
  const res = await fetch(`${base}${endpoint}?prettyPrint=false`, {
    signal: AbortSignal.timeout(8000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Origin: base.startsWith(YTM) ? 'https://music.youtube.com' : 'https://www.youtube.com',
    },
    body: JSON.stringify({ context: { client: { ...client, hl: 'en', gl: 'US' } }, ...body }),
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  return res.json();
}
const ytm = (endpoint, body) =>
  innertube(YTM, endpoint, { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00' }, body);
const yt = (endpoint, body) =>
  innertube(YT, endpoint, { clientName: 'WEB', clientVersion: '2.20250101.00.00' }, body);

function* find(o, key) {
  if (Array.isArray(o)) for (const v of o) yield* find(v, key);
  else if (o && typeof o === 'object')
    for (const k in o) {
      if (k === key) yield o[k];
      yield* find(o[k], key);
    }
}

const text = (t) => (t?.runs || []).map((r) => r.text).join('') || t?.simpleText || '';
const seconds = (s) => (s || '').split(':').reduce((a, n) => a * 60 + Number(n), 0) || 0;

// Google image URLs accept a size suffix, so any thumbnail can become a crisp cover.
function bigArt(thumbs, videoId) {
  const url = thumbs?.at?.(-1)?.url || '';
  if (/googleusercontent|ggpht/.test(url)) return url.replace(/=w\d+-h\d+.*$/, '=w1200-h1200-l90-rj');
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : url;
}

function parseByline(str) {
  const parts = str.split(' • ').map((s) => s.trim()).filter(Boolean);
  if (/^(Song|Video|Episode)$/.test(parts[0])) parts.shift();
  let duration = 0;
  if (/^\d+:\d{2}(:\d{2})?$/.test(parts.at(-1) || '')) duration = seconds(parts.pop());
  if (/views|plays/.test(parts.at(-1) || '')) parts.pop();
  return { artist: parts[0] || '', album: parts[1] && !/^\d{4}$/.test(parts[1]) ? parts[1] : '', duration };
}

export async function search(q, limit = 20) {
  const data = await ytm('search', { query: q, params: SONGS_FILTER });
  const out = [];
  for (const it of find(data, 'musicResponsiveListItemRenderer')) {
    const cols = it.flexColumns || [];
    const first = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const id =
      it.playlistItemData?.videoId ||
      first?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
      [...find(it.overlay, 'videoId')][0];
    if (!id || out.some((s) => s.id === id)) continue;
    const meta = parseByline(text(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text));
    out.push({ id, title: text(first), ...meta, art: bigArt(it.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, id) });
    if (out.length >= limit) break;
  }
  return out;
}

// The "Mix" YouTube Music builds for any song. The first item is the seed itself.
// Google answers the `next` call with a 403 captcha page for Cloudflare's network
// (search and player are fine), so when it fails we rebuild the same list from
// `music/get_queue`, which returns the same renderers and is not blocked there.
function mixTracks(data, limit = 50) {
  const out = [];
  const seen = new Set();
  for (const it of find(data, 'playlistPanelVideoRenderer')) {
    if (!it.videoId || out.some((s) => s.id === it.videoId)) continue;
    const meta = parseByline(text(it.longBylineText));
    const track = { id: it.videoId, title: text(it.title), ...meta, duration: seconds(text(it.lengthText)), art: bigArt(it.thumbnail?.thumbnails, it.videoId) };
    const key = `${track.title}|${track.artist}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

export async function radio(id) {
  // get_queue answers from Cloudflare, where YouTube refuses next. Its mix leaves the seed out,
  // so the seed is fetched alongside. next stays as the fallback.
  try {
    const [mix, seed] = await Promise.all([
      ytm('music/get_queue', { playlistId: `RDAMVM${id}` }),
      ytm('music/get_queue', { videoIds: [id] }),
    ]);
    const out = mixTracks({ seed, mix });
    if (out.length > 1) return out;
  } catch {}
  return mixTracks(await ytm('next', { videoId: id, playlistId: `RDAMVM${id}`, isAudioOnly: true }));
}

// Plain YouTube results, used when a song's main upload refuses to play embedded.
export async function alternates(q) {
  const data = await yt('search', { query: q });
  const ids = [];
  for (const v of find(data, 'videoRenderer')) if (v.videoId && !ids.includes(v.videoId)) ids.push(v.videoId);
  return ids.slice(0, 6);
}

// Public Spotify playlists, albums and tracks, read from the open embed page.
export async function spotify(url) {
  const m = String(url).match(/(playlist|album|track)[/:]([A-Za-z0-9]{22})/);
  if (!m) throw new Error('That does not look like a Spotify playlist, album or track link.');
  const [, type, id] = m;
  return coalesce(`spotify|${type}|${id}`, () => spotifyRead(type, id));
}

async function spotifyRead(type, id) {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Spotify did not share that one. Is it public?');
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)?.[1];
  const e = json && JSON.parse(json)?.props?.pageProps?.state?.data?.entity;
  if (!e) throw new Error('Could not read that Spotify page.');
  const cover = [...(e.coverArt?.sources || e.visualIdentity?.image || [])].sort((a, b) => (b.maxWidth || b.width || 0) - (a.maxWidth || a.width || 0))[0]?.url?.replace('00001e02', '0000b273') || '';
  const artists = (e.artists || []).map((a) => a.name).join(', ');
  const list = e.trackList?.length
    ? e.trackList
    : [{ title: e.name || e.title, subtitle: artists || e.subtitle, duration: e.duration }];
  return {
    id: `sp-${type}-${id}`,
    source: 'spotify',
    kind: type,
    name: e.name || e.title || 'Imported',
    by: e.subtitle || artists || (e.authors || []).map((a) => a.name).join(', '),
    cover,
    tracks: list.map((t) => ({
      title: t.title,
      artist: (t.subtitle || '').replace(/ /g, ' '),
      duration: Math.round((t.duration?.totalMilliseconds ?? t.duration ?? 0) / 1000),
      art: type === 'album' ? cover : '',
    })),
  };
}

// ---------- HTTP wrappers ----------

// Read-only endpoints sit behind the Workers Cache API (caches.default) when it exists, which
// is the case on Cloudflare and not under node server.js or Vercel, where this layer is skipped.
// Entries are served fresh until their ttl, then served stale while one refresh runs in the
// background (ctx.waitUntil). Only successful, non-empty answers are stored.
const KEEP_STALE = 86400; // how long past ttl a stored answer may still be served while refreshing
const SWR = 86400;

const hasData = (d) => (Array.isArray(d) ? d.length > 0 : Array.isArray(d?.tracks) ? d.tracks.length > 0 : Boolean(d));

// snap: { status, body, type, cacheable, cors }
function respond(snap, state, fresh, browser) {
  const ok = snap.status === 200;
  let cc = 'no-store';
  if (ok && !snap.cacheable) cc = 'public, max-age=30, s-maxage=30';
  else if (ok && state === 'STALE') cc = `public, max-age=60, s-maxage=60, stale-while-revalidate=${SWR}`;
  else if (ok) cc = `public, max-age=${Math.min(browser, fresh)}, s-maxage=${fresh}, stale-while-revalidate=${SWR}`;
  const headers = { 'Content-Type': snap.type, 'Cache-Control': cc, 'X-Hum-Cache': state };
  if (snap.cors) headers['Access-Control-Allow-Origin'] = '*';
  return new Response(snap.body, { status: snap.status, headers });
}

// opts: { name, params, ttl, browser }. params is the normalized key (case rules differ per
// endpoint, video ids are case sensitive), run() builds a fresh snapshot.
async function serve(request, ctx, { name, params, ttl, browser }, run) {
  const cache = request.method === 'GET' ? globalThis.caches?.default : undefined;
  const sorted = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
  const origin = new URL(request.url).origin;
  const id = `${origin}${name}?${sorted}`;

  const fill = async () => {
    const snap = await run();
    if (cache && snap.status === 200 && snap.cacheable) {
      const put = cache
        .put(
          new Request(id),
          new Response(snap.body, {
            headers: { 'Content-Type': snap.type, 'Cache-Control': `public, max-age=${ttl + KEEP_STALE}`, 'X-Hum-Stored': String(Date.now()), 'X-Hum-Cors': snap.cors ? '1' : '' },
          })
        )
        .catch(() => {});
      ctx?.waitUntil?.(put);
    }
    return snap;
  };
  const flight = () => {
    const p = coalesce(`serve|${id}`, fill);
    ctx?.waitUntil?.(p.catch(() => {})); // keep the shared call alive if the first caller disconnects
    return p;
  };

  let hit;
  if (cache) hit = await cache.match(new Request(id)).catch(() => undefined);
  if (hit) {
    const snap = { status: 200, body: await hit.text(), type: hit.headers.get('Content-Type'), cacheable: true, cors: Boolean(hit.headers.get('X-Hum-Cors')) };
    const age = (Date.now() - (Number(hit.headers.get('X-Hum-Stored')) || 0)) / 1000;
    if (age < ttl) return respond(snap, 'HIT', Math.max(1, Math.floor(ttl - age)), browser);
    flight().catch(() => {});
    return respond(snap, 'STALE', 0, browser);
  }
  return respond(await flight(), 'MISS', ttl, browser);
}

const lower = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();

// key(params) -> the normalized cache key fields for that endpoint.
export const route = (fn, { ttl, browser = 900, key }) => async (request, ctx) => {
  const url = new URL(request.url);
  const run = async () => {
    try {
      const data = await fn(url.searchParams);
      return { status: 200, body: JSON.stringify(data), type: 'application/json; charset=utf-8', cacheable: hasData(data), cors: true };
    } catch (err) {
      return { status: 502, body: JSON.stringify({ error: err.message || 'Something went wrong' }), type: 'application/json; charset=utf-8', cacheable: false, cors: true };
    }
  };
  return serve(request, ctx, { name: url.pathname, params: key(url.searchParams), ttl, browser }, run);
};

// Shared song links (/s/<id>) unfurl in chats and social apps with the song's
// own cover, then hand the visitor to the app.
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function share(request, ctx) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || url.pathname.split('/').pop() || '').match(/^[\w-]{11}$/)?.[0];
  if (!id) return respond(await shareSnap(url, id), 'MISS', 0, 300);
  return serve(request, ctx, { name: url.pathname, params: { id }, ttl: 86400, browser: 300 }, () => shareSnap(url, id));
}

async function shareSnap(url, id) {
  const app = `${url.origin}/#/s/${id || ''}`;
  let t = null;
  if (id) t = (await radio(id).catch(() => []))[0] || null;
  const title = t ? `${t.title} · ${t.artist}` : 'hum';
  const desc = t ? `Play “${t.title}” free on hum, with lyrics and an endless mix after it.` : 'Every song ever made. Free.';
  const image = t?.art || `${url.origin}/og.jpg`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="hum">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:url" content="${escHtml(url.href)}">
<meta name="twitter:card" content="${t?.art ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(image)}">
<meta name="theme-color" content="#07060a">
<meta http-equiv="refresh" content="0; url=${escHtml(app)}">
<link rel="icon" href="/icon.svg">
</head><body style="background:#07060a;color:#f6f2ec;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<a href="${escHtml(app)}" style="color:inherit">Open ${escHtml(title)} on hum</a>
<script>location.replace(${JSON.stringify(app)})</script>
</body></html>`;
  return { status: 200, body: html, type: 'text/html; charset=utf-8', cacheable: Boolean(t), cors: false };
}

export const handlers = {
  share,
  search: route(
    async (p) => {
      const q = (p.get('q') || '').trim();
      return q ? search(q, Math.min(Number(p.get('limit')) || 20, 40)) : [];
    },
    { ttl: 6 * 3600, key: (p) => ({ q: lower(p.get('q')), limit: Math.min(Number(p.get('limit')) || 20, 40) }) }
  ),
  radio: route(async (p) => radio(p.get('id') || ''), { ttl: 6 * 3600, key: (p) => ({ id: (p.get('id') || '').trim() }) }),
  alt: route(async (p) => alternates(p.get('q') || ''), { ttl: 6 * 3600, key: (p) => ({ q: lower(p.get('q')) }) }),
  import: route(async (p) => spotify(p.get('url') || ''), {
    ttl: 3600,
    browser: 600,
    // Playlist, album and track ids are case sensitive, so key on type and id, not the raw link.
    key: (p) => {
      const m = String(p.get('url') || '').match(/(playlist|album|track)[/:]([A-Za-z0-9]{22})/);
      return m ? { type: m[1], id: m[2] } : { url: String(p.get('url') || '').trim() };
    },
  }),
};
