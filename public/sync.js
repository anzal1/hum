// Library sync with no account. A random 128-bit secret (the "sync code") is turned into
// a record id and an AES-GCM key in the browser. The server only ever sees the id and
// ciphertext. This file has no DOM code: the crypto and merge rules are plain functions
// (tested in test/e2e.js) and `createSync` is the small engine that talks to /api/sync.
import { keyOf } from './engine.js';

export const KEYS = ['liked', 'playlists', 'recent', 'taste', 'variants'];
const DAY = 864e5;
const TOMB_TTL = 180 * DAY;
const RECENT_MAX = 30;
const enc = new TextEncoder();

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// ---------- the sync code ----------

// Crockford base32: no I, L, O or U, so a code survives being read aloud or typed from a photo.
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

export const makeSecret = () => crypto.getRandomValues(new Uint8Array(16));

// 16 secret bytes plus 1 check byte = 136 bits = 28 characters, shown as 7 groups of 4.
export async function codeFromSecret(secret) {
  const bytes = new Uint8Array(17);
  bytes.set(secret);
  bytes[16] = (await sha(secret))[0];
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  bits = bits.padEnd(140, '0');
  let out = '';
  for (let i = 0; i < 140; i += 5) out += ABC[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}

export async function secretFromCode(text) {
  const clean = String(text || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== 28) throw new SyncError('code', 'A sync code has 28 letters and numbers, like XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.');
  let bits = '';
  for (const ch of clean) {
    const v = ABC.indexOf(ch);
    if (v < 0) throw new SyncError('code', `“${ch}” is not used in sync codes.`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(17);
  for (let i = 0; i < 17; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const secret = bytes.slice(0, 16);
  if (/1/.test(bits.slice(136)) || (await sha(secret))[0] !== bytes[16]) throw new SyncError('code', 'That code has a typo somewhere. Check it and try again.');
  return secret;
}

// ---------- keys and encryption ----------

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Two different HKDF outputs from one secret: the record id (public to the server) and the key (never leaves).
export async function deriveKeys(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const salt = enc.encode('hum-sync-v1');
  const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('hum/sync/id') }, base, 256);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('hum/sync/key') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id: b64url(new Uint8Array(idBits)), key };
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// Blob layout: [format byte][12 byte iv][AES-GCM ciphertext + tag]. Format 2 means gzip before encrypt.
// The format byte and the id are bound in as additional data, so a blob cannot be moved to another id.
export async function seal({ id, key }, doc) {
  const plain = enc.encode(JSON.stringify(doc));
  const fmt = canGzip ? 2 : 1;
  const data = fmt === 2 ? await pipe(plain, new CompressionStream('gzip')) : plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new Uint8Array([fmt, ...enc.encode(id)]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data));
  const out = new Uint8Array(13 + ct.length);
  out[0] = fmt;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function open({ id, key }, blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const fmt = bytes[0];
  if ((fmt !== 1 && fmt !== 2) || bytes.length < 30) throw new SyncError('wrong', 'That is not a hum sync blob.');
  let data;
  try {
    const aad = new Uint8Array([fmt, ...enc.encode(id)]);
    data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: aad }, key, bytes.slice(13)));
    if (fmt === 2) data = await pipe(data, new DecompressionStream('gzip'));
  } catch {
    throw new SyncError('wrong', 'That code does not unlock this library.');
  }
  const doc = JSON.parse(new TextDecoder().decode(data));
  if (!doc || doc.v !== 1) throw new SyncError('wrong', 'This library was written by a newer hum. Update hum to sync it.');
  return doc;
}

// ---------- helpers ----------

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const arr = (x) => (Array.isArray(x) ? x : []);

export function stable(x) {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (isObj(x))
    return `{${Object.keys(x)
      .sort()
      .filter((k) => x[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(x[k])}`)
      .join(',')}}`;
  return JSON.stringify(x) ?? 'null';
}

// Small non-cryptographic hash (cyrb53), only used to notice that something changed.
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const hashDoc = (doc) => hash(stable(doc));

// A song's identity for sync. keyOf prefers the YouTube id, but a song's id can appear later
// (when an imported track is first played), so sync keys on title|artist and falls back to keyOf.
export const trackKey = (t) => (t?.title ? `${t.title}|${t.artist || ''}`.toLowerCase() : keyOf(t || {}));

const maxMap = (a = {}, b = {}) => {
  const out = { ...a };
  for (const k in b) if (!(k in out) || b[k] > out[k]) out[k] = b[k];
  return out;
};
const prune = (map = {}, now, ttl = TOMB_TTL) => Object.fromEntries(Object.entries(map).filter(([, t]) => now - t < ttl));
const alive = (adds, dels, k) => (adds[k] || 0) >= (dels[k] || 0);
const stripUpdated = ({ updated, ...rest }) => rest;
const plHash = (p) => hash(stable(stripUpdated(p)));

// ---------- the document that gets encrypted ----------
//
// meta (kept locally, never sent on its own) remembers what we saw last, so a diff against the
// store tells us what the person did: liked or unliked a song, edited or deleted a playlist,
// played something. Those become timestamps and tombstones inside the document, which is what
// lets removals travel instead of being undone by the next merge.

export const emptyMeta = () => ({ likedAdds: {}, likedDels: {}, plHash: {}, plUpdated: {}, plDels: {}, recentAt: {}, recentKeys: [] });

export function buildDoc(values, meta0 = emptyMeta(), now = Date.now()) {
  const meta = { ...emptyMeta(), ...JSON.parse(JSON.stringify(meta0)) };

  // liked: a key is added at the time it appears and removed (tombstoned) at the time it disappears
  const liked = [];
  const curLiked = new Set();
  for (const t of arr(values.liked)) {
    const k = trackKey(t);
    if (!curLiked.has(k)) (curLiked.add(k), liked.push(t));
  }
  for (const k of Object.keys(meta.likedAdds)) {
    if (!curLiked.has(k)) {
      meta.likedDels[k] = Math.max(now, (meta.likedAdds[k] || 0) + 1, meta.likedDels[k] || 0);
      delete meta.likedAdds[k];
    }
  }
  liked.forEach((t, i) => {
    const k = trackKey(t);
    if (!(k in meta.likedAdds) || !alive(meta.likedAdds, meta.likedDels, k)) meta.likedAdds[k] = Math.max(now - i, (meta.likedDels[k] || 0) + 1);
  });

  // playlists: stamped when their content changes, tombstoned when they disappear
  const playlists = [];
  const curPl = new Set();
  for (const p of arr(values.playlists)) {
    if (!p || typeof p.id !== 'string' || curPl.has(p.id)) continue;
    curPl.add(p.id);
    const h = plHash(p);
    if (meta.plHash[p.id] !== h) {
      meta.plHash[p.id] = h;
      meta.plUpdated[p.id] = Math.max(now, (meta.plDels[p.id] || 0) + 1, (meta.plUpdated[p.id] || 0) + 1);
    }
    playlists.push({ ...stripUpdated(p), updated: meta.plUpdated[p.id] });
  }
  for (const id of Object.keys(meta.plHash)) {
    if (!curPl.has(id)) {
      meta.plDels[id] = Math.max(now, (meta.plUpdated[id] || 0) + 1, meta.plDels[id] || 0);
      delete meta.plHash[id];
      delete meta.plUpdated[id];
    }
  }

  // recent: whatever moved to the front since last time was played just now
  const recent = [];
  const curRecent = new Set();
  for (const t of arr(values.recent)) {
    const k = trackKey(t);
    if (!curRecent.has(k)) (curRecent.add(k), recent.push(t));
  }
  const keys = recent.map(trackKey);
  const first = meta.recentKeys[0];
  const n = first === undefined ? -1 : keys.indexOf(first);
  const recentAt = {};
  keys.forEach((k, i) => {
    const touched = first === undefined || !(k in meta.recentAt) || (n >= 0 && i < n);
    recentAt[k] = touched ? Math.max(now - i, meta.recentAt[k] || 0) : meta.recentAt[k];
  });
  meta.recentAt = recentAt;
  meta.recentKeys = keys;

  const doc = {
    v: 1,
    liked,
    likedAdds: Object.fromEntries(Object.entries(meta.likedAdds).filter(([k]) => curLiked.has(k))),
    likedDels: prune(meta.likedDels, now),
    playlists,
    playlistDels: prune(meta.plDels, now),
    recent: recent.slice(0, RECENT_MAX),
    recentAt,
  };
  meta.likedDels = doc.likedDels;
  meta.plDels = doc.playlistDels;
  for (const k of ['taste', 'variants']) if (values[k] !== undefined && values[k] !== null) doc[k] = values[k];
  return { doc, meta };
}

// What goes back into the store, and the meta that matches it, after a merge.
export function docValues(doc) {
  const out = { liked: arr(doc.liked), playlists: arr(doc.playlists).map(stripUpdated), recent: arr(doc.recent) };
  for (const k of ['taste', 'variants']) if (doc[k] !== undefined) out[k] = doc[k];
  return out;
}
export function metaFromDoc(doc) {
  const m = emptyMeta();
  m.likedAdds = { ...doc.likedAdds };
  m.likedDels = { ...doc.likedDels };
  for (const p of arr(doc.playlists)) ((m.plHash[p.id] = plHash(p)), (m.plUpdated[p.id] = p.updated || 0));
  m.plDels = { ...doc.playlistDels };
  m.recentAt = { ...doc.recentAt };
  m.recentKeys = arr(doc.recent).map(trackKey);
  return m;
}

// ---------- merge rules (pure) ----------

// liked: union by song, a removal beats an add that happened before it, newest first
export function mergeLiked(a, b, now = Date.now()) {
  const adds = maxMap(a.likedAdds, b.likedAdds);
  const dels = prune(maxMap(a.likedDels, b.likedDels), now);
  const seen = new Map();
  for (const t of [...arr(a.liked), ...arr(b.liked)]) {
    const k = trackKey(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  const items = [...seen].map(([k, t], i) => ({ k, t, i })).filter(({ k }) => alive(adds, dels, k));
  items.sort((x, y) => (adds[y.k] || 0) - (adds[x.k] || 0) || x.i - y.i);
  return {
    liked: items.map(({ t }) => t),
    likedAdds: Object.fromEntries(items.filter(({ k }) => k in adds).map(({ k }) => [k, adds[k]])),
    likedDels: dels,
  };
}

// playlists: union by id, the newest edit of each wins, a delete beats an older edit
export function mergePlaylists(a, b, now = Date.now()) {
  const dels = prune(maxMap(a.playlistDels, b.playlistDels), now);
  const pick = (x, y) => ((x.updated || 0) !== (y.updated || 0) ? ((x.updated || 0) > (y.updated || 0) ? x : y) : stable(x) >= stable(y) ? x : y);
  const local = new Map(arr(a.playlists).map((p) => [p.id, p]));
  const out = [];
  const used = new Set();
  const fromRemote = new Map(arr(b.playlists).map((p) => [p.id, p]));
  const newcomers = [...fromRemote.values()].filter((p) => !local.has(p.id)).sort((x, y) => (y.updated || 0) - (x.updated || 0));
  for (const p of [...newcomers, ...local.values()]) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    const merged = fromRemote.has(p.id) && local.has(p.id) ? pick(local.get(p.id), fromRemote.get(p.id)) : p;
    if ((merged.updated || 0) >= (dels[p.id] || 0)) out.push(merged);
  }
  return { playlists: out, playlistDels: dels };
}

// recent: merge by play time, keep 30
export function mergeRecent(a, b) {
  const at = maxMap(a.recentAt, b.recentAt);
  const seen = new Map();
  for (const t of [...arr(a.recent), ...arr(b.recent)]) {
    const k = trackKey(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  const items = [...seen].map(([k, t], i) => ({ k, t, i })).sort((x, y) => (at[y.k] || 0) - (at[x.k] || 0) || x.i - y.i).slice(0, RECENT_MAX);
  return { recent: items.map(({ t }) => t), recentAt: Object.fromEntries(items.filter(({ k }) => k in at).map(({ k }) => [k, at[k]])) };
}

// taste: treated as opaque JSON that grows. Objects merge key by key, numbers (counters and
// timestamps alike) take the max, anything else picks one side the same way on every device.
export function mergeTaste(x, y) {
  if (x === undefined || x === null) return y;
  if (y === undefined || y === null) return x;
  if (isNum(x) && isNum(y)) return Math.max(x, y);
  if (isObj(x) && isObj(y)) {
    const out = {};
    for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) out[k] = mergeTaste(x[k], y[k]);
    return out;
  }
  return stable(x) >= stable(y) ? x : y;
}

// variants: opaque too. Per playlist, the entry with the newest timestamp wins.
const STAMPS = ['updated', 'at', 'ts', 'time', 'created', 'generated', 't'];
const stampOf = (e) => (isObj(e) ? Math.max(0, ...STAMPS.map((k) => (isNum(e[k]) ? e[k] : 0))) : 0);
export function mergeVariants(x, y) {
  if (x === undefined || x === null) return y;
  if (y === undefined || y === null) return x;
  if (!isObj(x) || !isObj(y)) return stable(x) >= stable(y) ? x : y;
  const out = {};
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
    if (!(k in y)) out[k] = x[k];
    else if (!(k in x)) out[k] = y[k];
    else {
      const sx = stampOf(x[k]), sy = stampOf(y[k]);
      out[k] = sx !== sy ? (sx > sy ? x[k] : y[k]) : stable(x[k]) >= stable(y[k]) ? x[k] : y[k];
    }
  }
  return out;
}

export function mergeDocs(local, remote, now = Date.now()) {
  if (!remote) return local;
  const doc = { v: 1, ...mergeLiked(local, remote, now), ...mergePlaylists(local, remote, now), ...mergeRecent(local, remote) };
  const taste = mergeTaste(local.taste, remote.taste);
  const variants = mergeVariants(local.variants, remote.variants);
  if (taste !== undefined) doc.taste = taste;
  if (variants !== undefined) doc.variants = variants;
  return doc;
}

// ---------- the engine ----------

const MIN_PUSH_GAP = 30_000;
const PUSH_DELAY = 5_000;
const MIN_PULL_GAP = 60_000;

export function createSync({ store, fetch: doFetch = (...a) => globalThis.fetch(...a), now = () => Date.now(), base = '/api/sync', snapshot, onChange = () => {} }) {
  let state = store.get('sync', null);
  let creds = null;
  let running = null;
  let again = false;
  let timer = null;
  let lastPushAt = 0;
  const listeners = new Set();
  const snap = snapshot || (() => stable(KEYS.map((k) => store.get(k, null))));
  // With sync already on at load, start unknown so the first check pushes anything left unsent.
  let lastSnap = state ? null : snap();
  const status = { phase: state ? 'idle' : 'off', error: '' };

  const emit = () => listeners.forEach((fn) => fn(api.info));
  const set = (phase, error = '') => (Object.assign(status, { phase, error }), emit());
  const save = () => store.set('sync', state);
  const req = (path, init) => doFetch(`${base}${path}`, init);

  async function getCreds() {
    if (!creds) creds = await deriveKeys(await secretFromCode(state.code));
    return creds;
  }
  const readValues = () => Object.fromEntries(KEYS.map((k) => [k, store.get(k, undefined)]).filter(([, v]) => v !== undefined));

  // Write a merged document into the store. Returns which keys actually changed.
  function apply(merged) {
    const values = docValues(merged);
    const changed = [];
    for (const k of Object.keys(values)) {
      if (stable(values[k]) !== stable(store.get(k, undefined))) (store.set(k, values[k]), changed.push(k));
    }
    lastSnap = snap();
    return changed;
  }

  async function get(id, since) {
    const res = await req(`/${id}${since ? `?since=${since}` : ''}`);
    if (![200, 204, 404].includes(res.status)) throw new SyncError(res.status === 501 ? 'unavailable' : 'http', res.status === 501 ? 'Sync is not available on this server.' : `The sync server answered ${res.status}.`);
    return res;
  }

  // One full round: read local, pull, merge, write local, push if the merge differs from the server.
  async function cycle() {
    const c = await getCreds();
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await get(c.id, state.version);
      state.lastPulled = now();
      let remote = null;
      let remoteHash = null;
      let baseVersion = 0;
      if (res.status === 200) {
        remote = await open(c, await res.arrayBuffer());
        remoteHash = hashDoc(remote);
        baseVersion = Number(res.headers.get('x-sync-version')) || 0;
      } else if (res.status === 204) {
        remoteHash = state.syncedHash;
        baseVersion = state.version;
      }
      // Read the library only now, so nothing the person did while we waited gets overwritten.
      const local = buildDoc(readValues(), state.meta, now());
      const merged = mergeDocs(local.doc, remote, now());
      const changed = apply(merged);
      state.meta = metaFromDoc(merged);
      const mh = hashDoc(merged);
      if (mh === remoteHash) {
        Object.assign(state, { version: baseVersion, syncedHash: mh, lastSynced: now() });
        save();
        if (changed.length) onChange(changed);
        return;
      }
      const body = await seal(c, merged);
      if (body.length > 512 * 1024) throw new SyncError('big', 'Your library is too big to sync (512 KB limit). Export it as a backup instead.');
      const put = await req(`/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Sync-Base': String(baseVersion) }, body });
      if (put.status === 200) {
        const { version } = await put.json();
        Object.assign(state, { version, syncedHash: mh, lastSynced: now() });
        lastPushAt = now();
        save();
        if (changed.length) onChange(changed);
        return;
      }
      save();
      if (changed.length) onChange(changed);
      if (put.status === 409) continue;
      if (put.status === 429) {
        const wait = Number(put.headers.get('retry-after')) || 10;
        throw new SyncError('rate', `Syncing again in ${wait} seconds.`);
      }
      if (put.status === 413) throw new SyncError('big', 'Your library is too big to sync (512 KB limit). Export it as a backup instead.');
      throw new SyncError('http', `The sync server answered ${put.status}.`);
    }
    throw new SyncError('conflict', 'Another device kept changing the library. Will try again.');
  }

  function run() {
    if (!state) return Promise.resolve(false);
    if (running) return ((again = true), running);
    set('syncing');
    running = cycle()
      .then(() => (set('idle'), true))
      .catch((e) => {
        if (e instanceof SyncError && e.kind === 'rate') (set('idle', e.message), schedule(11_000));
        else set(e instanceof SyncError ? 'error' : 'offline', e instanceof SyncError ? e.message : 'Offline. Will try again when hum is back online.');
        return false;
      })
      .finally(() => {
        running = null;
        if (again) ((again = false), schedule(PUSH_DELAY));
      });
    return running;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => run(), delay);
  }

  const api = {
    get on() {
      return !!state;
    },
    get info() {
      return { on: !!state, code: state?.code || '', lastSynced: state?.lastSynced || 0, ...status };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Is there a database behind /api/sync on this server?
    async probe() {
      try {
        const res = await req('');
        const body = await res.json().catch(() => null);
        return res.status === 200 && body?.sync === true;
      } catch {
        return false;
      }
    },
    async enable() {
      if (state) return state.code;
      const secret = makeSecret();
      state = { code: await codeFromSecret(secret), version: 0, lastPulled: 0, lastSynced: 0, syncedHash: null, meta: emptyMeta() };
      creds = null;
      save();
      set('idle');
      run();
      return state.code;
    },
    // Check the code and find the library before turning anything on, so a typo changes nothing.
    async join(text) {
      const secret = await secretFromCode(text);
      const c = await deriveKeys(secret);
      let res;
      try {
        res = await get(c.id, 0);
      } catch (e) {
        if (e instanceof SyncError) throw e;
        throw new SyncError('offline', 'Could not reach the sync server. Check your connection.');
      }
      if (res.status === 404) throw new SyncError('missing', 'No library found for that code. Check it, or turn sync on from the device that has your library.');
      await open(c, await res.arrayBuffer());
      state = { code: await codeFromSecret(secret), version: 0, lastPulled: 0, lastSynced: 0, syncedHash: null, meta: emptyMeta() };
      creds = c;
      save();
      set('idle');
      return run();
    },
    // Stops syncing on this device. Local data stays, and so does the encrypted copy on the server.
    disable() {
      clearTimeout(timer);
      state = null;
      creds = null;
      store.set('sync', null);
      set('off');
    },
    now: () => run(),
    // Call when local data may have changed. Pushes about 5 s later, at most once per 30 s.
    changed() {
      if (!state) return;
      const wait = Math.max(PUSH_DELAY, MIN_PUSH_GAP - (now() - lastPushAt));
      if (!running) schedule(wait);
      else again = true;
    },
    // Compare a snapshot of the library with the last one, and treat a difference as a change.
    check() {
      const s = snap();
      if (s === lastSnap) return false;
      lastSnap = s;
      api.changed();
      return true;
    },
    // Pull on load and on focus, at most once a minute.
    pull(force = false) {
      if (!state || (!force && now() - (state.lastPulled || 0) < MIN_PULL_GAP)) return Promise.resolve(false);
      return run();
    },
    exportLibrary() {
      return { hum: 'library', v: 1, exported: new Date(now()).toISOString(), ...readValues() };
    },
    // Add a backup into the library. Nothing is replaced: it merges like another device would.
    importLibrary(file) {
      const clean = parseBackup(file);
      const incoming = buildDoc(clean, emptyMeta(), now() - 1e6).doc;
      const local = buildDoc(readValues(), state?.meta, now());
      const merged = mergeDocs(local.doc, incoming, now());
      const changed = apply(merged);
      if (state) ((state.meta = metaFromDoc(merged)), save());
      if (changed.length) onChange(changed);
      api.changed();
      return { changed, liked: clean.liked.length, playlists: clean.playlists.length };
    },
  };
  return api;
}

// A backup file is untrusted input. Keep only the shapes the app expects.
export function parseBackup(file) {
  if (!isObj(file) || file.hum !== 'library') throw new SyncError('file', 'That is not a hum library backup.');
  const track = (t) => isObj(t) && (typeof t.id === 'string' || typeof t.title === 'string');
  const out = {
    liked: arr(file.liked).filter(track),
    recent: arr(file.recent).filter(track).slice(0, RECENT_MAX),
    playlists: arr(file.playlists).filter((p) => isObj(p) && typeof p.id === 'string' && Array.isArray(p.tracks)).map((p) => ({ ...p, tracks: p.tracks.filter(track) })),
  };
  for (const k of ['taste', 'variants']) if (file[k] !== undefined && file[k] !== null) out[k] = file[k];
  return out;
}
