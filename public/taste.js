// Taste: what you finish, skip and like, and the "For you" versions of playlists
// and stations built from it. The rules are plain functions over plain data, so
// they are easy to test. The app wires them to the engine and draws the result.
import { store, keyOf, nameKey } from './engine.js';

export const RULES = Object.freeze({
  completeAt: 0.8, // past this share of a song counts as finishing it
  skipSeconds: 30, // skipped before this many seconds...
  skipShare: 0.25, // ...or this share of the song, whichever is smaller, is an early skip
  minHeard: 1, // under a second of playing is not a listen at all
  cap: 600, // songs remembered, most recent first
  halfLifeDays: 45,
  like: 4,
  complete: 1,
  completeMax: 5,
  replay: 1.5,
  replayMax: 3,
  skip: -2,
  skipMax: 5,
  startFinds: 3, // finds a variant opens with
  dailyFinds: 3, // finds added on each new day it is opened
  findShare: 0.3, // finds never make up more than this share of the list
  retireAt: 2, // early skips that retire a find, or send a playlist song to the end
  seeds: 3, // songs whose radio we mine for finds
  signalPlays: 5, // listens before the home page starts making things for you
  retiredMax: 200,
  usesMax: 60,
});

// Tests move time by replacing clock.now.
export const clock = { now: () => new Date() };
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = clock.now()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = 86400000;

const slim = ({ id, title, artist, album, art }) => ({ id, title, artist, album, art });
const slimFind = ({ id, title, artist, album, art, duration }) => ({ id, title, artist, album, art, duration });

// ---------- signals ----------

export const skipLimit = (duration) => (duration > 0 ? Math.min(RULES.skipSeconds, duration * RULES.skipShare) : RULES.skipSeconds);

// What one listen said about a song. time is where playback was when the song was left.
// exit: end (played out), skip (next or jump), switch (new list or previous), leave (page closed), error.
export function judge({ time = 0, duration = 0, exit = 'switch' }) {
  if (exit === 'error') return { play: false, complete: false, skip: false };
  const complete = exit === 'end' || (duration > 0 && time >= duration * RULES.completeAt);
  const skip = exit === 'skip' && !complete && time >= RULES.minHeard && time < skipLimit(duration);
  return { play: complete || time >= RULES.minHeard, complete, skip };
}

export const decay = (days) => Math.pow(0.5, Math.max(0, days) / RULES.halfLifeDays);

// The taste score of one song. Pure: pass what is known about it and the time.
export function score(stat, { liked = false, now = Date.now() } = {}) {
  const s = stat || {};
  const replays = Math.max(0, (s.plays || 0) - 1);
  const raw =
    (liked ? RULES.like : 0) +
    Math.min(s.completes || 0, RULES.completeMax) * RULES.complete +
    Math.min(replays, RULES.replayMax) * RULES.replay +
    Math.min(s.skips || 0, RULES.skipMax) * RULES.skip;
  const at = s.lastPlayed || s.firstSeen;
  return raw * decay(at ? (now - at) / DAY : 0);
}

// ---------- storage ----------

export function loadTaste() {
  const s = store.get('taste', null);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { tracks: obj(s?.tracks), uses: obj(s?.uses) };
}
export const saveTaste = (t) => store.set('taste', t);
export const loadVariants = () => {
  const v = store.get('variants', null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
export const saveVariants = (v) => store.set('variants', v);

// Both ways a song can be known (by id, or by title and artist) point at the same entry.
export function indexTaste(taste) {
  const idx = new Map();
  for (const [k, e] of Object.entries(taste.tracks || {})) {
    idx.set(k, e);
    if (e.nk && !idx.has(e.nk)) idx.set(e.nk, e);
  }
  return idx;
}
export const statOf = (idx, t) => idx.get(keyOf(t)) || idx.get(nameKey(t));
export const likedKeySet = (liked) => new Set(liked.flatMap((t) => [keyOf(t), nameKey(t)]));
export const isLikedIn = (set, t) => set.has(keyOf(t)) || set.has(nameKey(t));

// Add one listen to the taste, in place. Returns it.
export function recordListen(taste, track, verdict, now, ctx) {
  if (!verdict.play) return taste;
  const tracks = (taste.tracks ||= {});
  const k = keyOf(track), nk = nameKey(track);
  const had = tracks[k] ? k : Object.keys(tracks).find((x) => tracks[x].nk === nk);
  const e = (had && tracks[had]) || { plays: 0, completes: 0, skips: 0, firstSeen: now };
  if (had && had !== k) delete tracks[had]; // a song found on YouTube changes its key; keep one entry
  e.plays++;
  if (verdict.complete) e.completes++;
  if (verdict.skip) e.skips++;
  e.lastPlayed = now;
  e.nk = nk;
  e.track = slim(track);
  tracks[k] = e;
  const keys = Object.keys(tracks);
  if (keys.length > RULES.cap) {
    keys.sort((a, b) => tracks[b].lastPlayed - tracks[a].lastPlayed);
    for (const x of keys.slice(RULES.cap)) delete tracks[x];
  }
  if (ctx?.key) {
    const uses = (taste.uses ||= {});
    const u = (uses[ctx.key] ||= { n: 0 });
    u.n++;
    u.last = now;
    u.name = ctx.name;
    const names = Object.keys(uses);
    if (names.length > RULES.usesMax) {
      names.sort((a, b) => uses[b].last - uses[a].last);
      for (const x of names.slice(RULES.usesMax)) delete uses[x];
    }
  }
  return taste;
}

// Watches the engine and writes each listen into the taste store.
export function attachListener(engine, { onJudged, now = () => clock.now().getTime() } = {}) {
  let open = null;
  const begin = () => {
    const t = engine.current;
    if (t) open = { track: { ...slim(t), duration: t.duration }, ctx: engine.ctx };
  };
  // Judged at the first fire of a track change, while the old song is still the one loaded.
  const finish = (exit) => {
    if (!open) return;
    const s = open;
    open = null;
    const verdict = judge({ time: engine.time, duration: engine.player?.duration || s.track.duration || 0, exit });
    if (!verdict.play) return;
    const taste = loadTaste();
    recordListen(taste, s.track, verdict, now(), s.ctx);
    saveTaste(taste);
    onJudged?.(s.track, verdict);
  };
  engine.addEventListener('started', begin);
  engine.addEventListener('playing', ({ detail }) => detail && !open && begin());
  engine.addEventListener('track', () => finish(engine.exit || 'switch'));
  engine.addEventListener('ended', () => {
    finish('end');
    if (engine.repeat === 'one') begin(); // it plays again
  });
  const leave = () => finish('leave');
  addEventListener('pagehide', leave);
  return { finish, leave, stop: () => removeEventListener('pagehide', leave) };
}

// ---------- ranking and variants ----------

export function rankTracks(tracks, idx, liked, now) {
  const rows = tracks.map((t, i) => {
    const st = statOf(idx, t);
    return { t, i, s: score(st, { liked: isLikedIn(liked, t), now }), avoid: (st?.skips || 0) >= RULES.retireAt };
  });
  // Liked and finished songs first, unknown songs in their own order, skipped ones last.
  return rows.sort((a, b) => a.avoid - b.avoid || b.s - a.s || a.i - b.i);
}

export const findCap = (own) => Math.max(1, Math.floor((own * RULES.findShare) / (1 - RULES.findShare)));
const blank = () => ({ finds: [], retired: [], lastGrown: '' });
const norm = (s) => ({ ...blank(), ...(s || {}), finds: [...(s?.finds || [])], retired: [...(s?.retired || [])] });
const keysOf = (list) => new Set(list.flatMap((t) => [keyOf(t), nameKey(t)]));

// Spread the finds evenly through the list, never right at the top.
export function weave(base, finds) {
  const n = base.length, m = finds.length;
  if (!n || !m) return base.slice();
  const out = [];
  let f = 0;
  for (let i = 0; i < n; i++) {
    out.push(base[i]);
    while (f < m && i + 1 >= Math.max(1, Math.round(((f + 1) * n) / (m + 1)))) out.push({ ...finds[f++], find: true });
  }
  while (f < m) out.push({ ...finds[f++], find: true });
  return out;
}

// The For you list as it stands now: the playlist's songs ranked, plus the finds kept so far.
// Needs no network. Songs marked find: true are the ones that were not in the playlist.
export function composeVariant(own, state, { taste, liked, now }) {
  const idx = indexTaste(taste);
  const ranked = rankTracks(own, idx, liked, now).map((r) => r.t);
  if (!ranked.length) return { list: [], finds: 0 };
  const have = keysOf(own);
  const finds = [];
  for (const f of norm(state).finds) {
    if (have.has(keyOf(f)) || have.has(nameKey(f)) || (statOf(idx, f)?.skips || 0) >= RULES.retireAt) continue;
    have.add(keyOf(f));
    have.add(nameKey(f));
    finds.push(f);
  }
  const kept = finds.slice(0, findCap(own.length));
  return { list: weave(ranked, kept), finds: kept.length };
}

// Move finds skipped twice out of the list for good.
export function retireSkipped(state, idx) {
  const st = norm(state);
  const keep = [], gone = [];
  for (const f of st.finds) ((statOf(idx, f)?.skips || 0) >= RULES.retireAt ? gone : keep).push(f);
  const retired = [...new Set([...st.retired, ...gone.flatMap((f) => [keyOf(f), nameKey(f)])])].slice(-RULES.retiredMax);
  return { state: { ...st, finds: keep, retired }, retired: gone.length };
}

// The slow buildup. Opens with a few finds, adds a few on each new day it is opened,
// stays under the cap, and replaces retired finds. Reaches the network only when it has
// something to add. radio(id) gives a mix, ensureId(track) gives a song its YouTube id.
export async function growFinds({ own, state, taste, liked, today, now, radio, ensureId }) {
  const idx = indexTaste(taste);
  const out = retireSkipped(state, idx);
  let st = out.state;
  const have = keysOf(own);
  st.finds = st.finds.filter((f) => !have.has(keyOf(f)) && !have.has(nameKey(f))); // joined the playlist itself
  const newDay = st.lastGrown !== today;
  const room = Math.max(0, findCap(own.length) - st.finds.length);
  const want = Math.min(room, (newDay ? (st.lastGrown ? RULES.dailyFinds : RULES.startFinds) : 0) + out.retired);
  const stamp = (s) => (newDay ? { ...s, lastGrown: today } : s);
  if (want <= 0 || !own.length) return { state: stamp(st), added: 0, retired: out.retired };

  const rows = rankTracks(own, idx, liked, now).filter((r) => !r.avoid);
  let seeds = rows.filter((r) => r.s > 0).slice(0, RULES.seeds);
  if (!seeds.length) seeds = [...rows].sort((a, b) => a.i - b.i).slice(0, RULES.seeds);
  const mixes = (
    await Promise.all(
      seeds.map(async (r) => {
        try {
          const id = await ensureId(r.t);
          return id ? await radio(id) : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);
  if (!mixes.length) return { state: st, added: 0, retired: out.retired, failed: true };

  const seen = new Set([...have, ...keysOf(st.finds), ...st.retired]);
  const usable = (x) => {
    if (!x?.title || !x.artist || !x.id || seen.has(keyOf(x)) || seen.has(nameKey(x))) return false;
    return !(statOf(idx, x)?.skips > 0); // never a song you already skipped
  };
  const picked = [];
  const queues = mixes.map((m) => m.filter(usable));
  for (let round = 0; picked.length < want && queues.some((q) => q.length); round++) {
    for (const q of queues) {
      while (q.length && !usable(q[0])) q.shift();
      const x = q.shift();
      if (!x || picked.length >= want) continue;
      seen.add(keyOf(x));
      seen.add(nameKey(x));
      picked.push({ ...slimFind(x), added: today });
    }
  }
  st = stamp({ ...st, finds: [...st.finds, ...picked] });
  return { state: st, added: picked.length, retired: out.retired };
}

// ---------- home ----------

export const totalPlays = (taste) => Object.values(taste.tracks || {}).reduce((a, e) => a + (e.plays || 0), 0);
export const hasSignal = (taste) => totalPlays(taste) >= RULES.signalPlays;

// Playlists and stations you play most, recent plays counting more.
export function topContexts(taste, now) {
  return Object.entries(taste.uses || {})
    .map(([key, u]) => ({ key, name: u.name, weight: u.n * decay((now - (u.last || now)) / DAY) }))
    .sort((a, b) => b.weight - a.weight);
}
