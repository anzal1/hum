// Shared server logic. Every handler is a plain Web `Request -> Response`
// function so the same code runs on Vercel, Cloudflare and the local server.

const YTM = 'https://music.youtube.com/youtubei/v1/';
const YT = 'https://www.youtube.com/youtubei/v1/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

async function innertube(base, endpoint, client, body) {
  const res = await fetch(`${base}${endpoint}?prettyPrint=false`, {
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
export async function radio(id) {
  const data = await ytm('next', { videoId: id, playlistId: `RDAMVM${id}`, isAudioOnly: true });
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
  }
  return out;
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

const json = (body, status = 200, maxAge = 3600) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? `public, max-age=300, s-maxage=${maxAge}, stale-while-revalidate=86400` : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });

export const route = (fn, maxAge) => async (request) => {
  const params = new URL(request.url).searchParams;
  try {
    return json(await fn(params), 200, maxAge);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong' }, 502);
  }
};

// Shared song links (/s/<id>) unfurl in chats and social apps with the song's
// own cover, then hand the visitor to the app.
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function share(request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || url.pathname.split('/').pop() || '').match(/^[\w-]{11}$/)?.[0];
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
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=86400' },
  });
}

export const handlers = {
  share,
  search: route(async (p) => {
    const q = (p.get('q') || '').trim();
    return q ? search(q, Math.min(Number(p.get('limit')) || 20, 40)) : [];
  }),
  radio: route(async (p) => radio(p.get('id') || ''), 1800),
  alt: route(async (p) => alternates(p.get('q') || '')),
  import: route(async (p) => spotify(p.get('url') || ''), 600),
};
