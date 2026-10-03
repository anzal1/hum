// Encrypted library sync. One opaque blob per id, stored in Cloudflare D1 (binding `SYNC`).
// The id and the ciphertext both come from the browser; the server cannot read the data.
//   GET /api/sync            200 when sync is available, 501 when there is no database
//   GET /api/sync/:id        200 ciphertext + X-Sync-Version, 204 if ?since= matches, 404 if none
//   PUT /api/sync/:id        body is ciphertext; X-Sync-Base is the version the client built on
//                            200 {version}, 409 stale base, 429 too soon, 413 too big

export const SYNC_MAX = 512 * 1024;
export const SYNC_MIN_GAP = 10_000;
export const syncId = (s) => /^[A-Za-z0-9_-]{43}$/.test(s || '');

const headers = (extra = {}) => ({ 'Cache-Control': 'no-store', ...extra });
const json = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: headers({ 'Content-Type': 'application/json; charset=utf-8', ...extra }) });

// Read the body with a hard cap, so a lying Content-Length cannot get past it.
async function limited(request) {
  if (Number(request.headers.get('content-length')) > SYNC_MAX) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > SYNC_MAX) {
      // Read a little more before giving up, so the connection is left clean for the next request.
      while (size < SYNC_MAX * 4) {
        const more = await reader.read();
        if (more.done) break;
        size += more.value.length;
      }
      return (reader.cancel().catch(() => {}), null);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.length));
  return out;
}

// D1 hands BLOB columns back as an ArrayBuffer or an array of numbers, depending on the runtime.
const bytes = (d) => (Array.isArray(d) ? Uint8Array.from(d) : new Uint8Array(d));

export async function sync(request, db, now = Date.now()) {
  if (!db) return json(501, { error: 'Sync is not set up on this server' });
  const url = new URL(request.url);
  const id = url.pathname.match(/^\/api\/sync\/?(.*)$/)?.[1] ?? '';
  if (!id) return request.method === 'GET' ? json(200, { sync: true, max: SYNC_MAX }) : json(405, { error: 'GET only' });
  if (!syncId(id)) return json(400, { error: 'Bad sync id' });

  if (request.method === 'GET') {
    const row = await db.prepare('SELECT data, version, updated FROM blobs WHERE id = ?').bind(id).first();
    if (!row) return json(404, { error: 'Nothing here' });
    const meta = { 'X-Sync-Version': String(row.version), 'X-Sync-Updated': String(row.updated) };
    if (url.searchParams.get('since') === String(row.version)) return new Response(null, { status: 204, headers: headers(meta) });
    return new Response(bytes(row.data), { headers: headers({ 'Content-Type': 'application/octet-stream', ...meta }) });
  }

  if (request.method !== 'PUT') return json(405, { error: 'GET or PUT only' });
  const base = request.headers.get('x-sync-base');
  if (!/^\d{1,12}$/.test(base || '')) return json(400, { error: 'X-Sync-Base must be the version you built on' });
  const body = await limited(request);
  if (!body) return json(413, { error: `Too big. The limit is ${SYNC_MAX / 1024} KB` });
  if (body.length < 30) return json(400, { error: 'Not a sync blob' });
  const from = Number(base);

  let changed;
  if (from === 0) {
    changed = (await db.prepare('INSERT INTO blobs (id, data, version, updated) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(id, body, now).run()).meta.changes;
  } else {
    // One statement checks the base version and the write rate, so two devices cannot both win.
    changed = (
      await db.prepare('UPDATE blobs SET data = ?, version = version + 1, updated = ? WHERE id = ? AND version = ? AND updated <= ?').bind(body, now, id, from, now - SYNC_MIN_GAP).run()
    ).meta.changes;
  }
  if (changed) return json(200, { version: from + 1, updated: now });

  const row = await db.prepare('SELECT version, updated FROM blobs WHERE id = ?').bind(id).first();
  if (!row || row.version !== from) return json(409, { error: 'Out of date', version: row?.version ?? 0 }, { 'X-Sync-Version': String(row?.version ?? 0) });
  const wait = Math.max(1, Math.ceil((row.updated + SYNC_MIN_GAP - now) / 1000));
  return json(429, { error: 'Too many writes', retry: wait }, { 'Retry-After': String(wait) });
}
