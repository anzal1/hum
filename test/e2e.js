// End-to-end sanity suite. Runs inside the app page (served at /__e2e.js while testing):
//   const r = await (await import('/__e2e.js')).run();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
async function until(fn, ms = 6000, step = 100) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(step);
  }
  throw new Error('timed out');
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const press = (key, opts = {}) => dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
const type = async (text) => {
  const q = $('#q');
  q.focus();
  q.value = text;
  q.dispatchEvent(new Event('input', { bubbles: true }));
};
const go = async (hash, wait = 700) => {
  location.hash = hash;
  await sleep(wait);
};
const act = (name, scope = document) => {
  const el = $$(`[data-act="${name}"]`, scope).find((b) => b.offsetParent || b.getClientRects().length) || $(`[data-act="${name}"]`, scope);
  el.click();
};

export async function run() {
  const E = window.__hum.engine;
  const results = [];
  const errors = [];
  const onErr = (e) => errors.push(e.message || String(e.reason));
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onErr);
  const origError = console.error;
  console.error = (...a) => (errors.push(a.join(' ')), origError(...a));
  const test = async (area, name, fn) => {
    try {
      await fn();
      results.push({ area, name, ok: true });
    } catch (e) {
      results.push({ area, name, ok: false, why: e.message });
    }
  };
  if ($('[data-act="close"]') && document.body.classList.contains('np-open')) act('close');

  // ---------------- search ----------------
  await go('#/');
  await test('search', 'typing on home shows results', async () => {
    await type('arijit singh');
    await until(() => location.hash.startsWith('#/search') && $$('#view .row[data-play]').length > 5);
  });
  await test('search', 'top result card has play, play next and like', async () => {
    const card = $('#view .top-card');
    assert(card && card.querySelector('.top-go') && card.querySelector('[data-row-queue="0"]') && card.querySelector('[data-row-like="0"]'), 'missing actions');
    assert(card.querySelector('.top-bg').style.backgroundImage.includes('url('), 'no cover glow behind the card');
  });
  await test('search', 'arrow down moves the selection', async () => {
    $('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await sleep(100);
    assert($('#view [data-play="1"]').classList.contains('sel'), 'row 1 not selected');
  });
  await test('search', 'enter plays the selected song', async () => {
    const want = $('#view [data-play="1"] .row-text b').textContent;
    $('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => E.current?.title === want);
  });
  await test('search', 'escape clears and returns home', async () => {
    $('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    assert($('#q').value === '' && document.body.classList.contains('home'), 'not home');
  });
  await test('search', 'no results shows a friendly empty state', async () => {
    const real = window.fetch;
    window.fetch = (u, ...a) => (String(u).includes('/api/search') ? Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } })) : real(u, ...a));
    await type('nothing will match ' + Date.now());
    try {
      await until(() => /Nothing for/.test($('#view').textContent), 3000);
    } finally {
      window.fetch = real;
    }
  });
  await test('search', 'html in a query is shown as text, never run', async () => {
    window.__xss = 0;
    await type('<img src=x onerror="window.__xss=1">');
    await sleep(2200);
    assert(!window.__xss, 'script ran');
    assert(!$('#view img[src="x"]'), 'raw html injected');
  });
  await test('search', 'non-latin query works', async () => {
    await type('तुम ही हो');
    await until(() => $$('#view .row[data-play]').length > 2);
  });
  await test('search', 'very long query does not break layout', async () => {
    await type('a'.repeat(300));
    await sleep(1800);
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'page scrolls sideways');
  });
  await test('search', 'pasting a YouTube link plays it', async () => {
    await type('https://www.youtube.com/watch?v=BddP6PYo2gs');
    await until(() => (E.current?.id === 'BddP6PYo2gs' || E.list.some((t) => t.id === 'BddP6PYo2gs')), 8000);
  });
  await test('search', 'pasting a Spotify album imports it', async () => {
    await type('https://open.spotify.com/album/1NAmidJlEaVgA3MpcPFYGq');
    await until(() => location.hash.startsWith('#/pl/') && $$('#view .row[data-play]').length > 10, 10000);
  });
  await test('search', 'bad Spotify link shows an error, not a crash', async () => {
    await type('https://open.spotify.com/playlist/AAAAAAAAAAAAAAAAAAAAAA');
    await until(() => /public|Spotify|read/i.test($('#view .empty')?.textContent || ''), 10000);
  });
  await test('search', 'api failure shows a message', async () => {
    const real = window.fetch;
    window.fetch = (u, ...a) => (String(u).includes('/api/search') ? Promise.reject(new TypeError('Failed to fetch')) : real(u, ...a));
    await type('this will fail ' + Date.now());
    await sleep(1200);
    window.fetch = real;
    assert($('#view .empty'), 'no error state shown');
  });
  await test('search', 'slim bar search button focuses the search box', async () => {
    await go('#/', 1200);
    await until(() => $('.stations'), 3000);
    scrollTo(0, 1200);
    await until(() => document.body.classList.contains('scrolled'), 3000).catch(() => {
      throw new Error('slim bar not shown');
    });
    $('.mini-search').click();
    await sleep(700);
    assert(document.activeElement === $('#q'), 'search not focused');
    $('#q').blur();
  });

  // ---------------- transport buttons ----------------
  await go('#/');
  await test('player', 'play and pause toggle', async () => {
    if (!E.playing) {
      act('toggle', $('#dock'));
      await until(() => E.playing, 8000);
    }
    act('toggle', $('#dock'));
    await until(() => !E.playing);
    act('toggle', $('#dock'));
    await until(() => E.playing, 8000);
  });
  await test('player', 'next moves forward in the queue', async () => {
    const i = E.i;
    act('next', $('#dock'));
    await until(() => E.i === i + 1);
  });
  await test('player', 'previous goes back (or restarts after 3s)', async () => {
    const i = E.i;
    await until(() => E.playing, 8000);
    act('prev', $('#dock'));
    await sleep(400);
    assert(E.i === i - 1 || E.time < 2, 'did not go back');
  });
  await test('player', 'shuffle toggles and is remembered', async () => {
    const was = E.shuffle;
    act('shuffle', $('#dock'));
    await sleep(100);
    assert(E.shuffle === !was && JSON.parse(localStorage.getItem('hum:shuffle')) === !was, 'not toggled');
    assert($('#dock .js-shuffle').classList.contains('on') === !was, 'button state wrong');
    act('shuffle', $('#dock'));
  });
  await test('player', 'repeat cycles off, all, one and back', async () => {
    const seen = [];
    for (let k = 0; k < 3; k++) {
      act('repeat', $('#dock'));
      await sleep(60);
      seen.push(E.repeat);
    }
    while (E.repeat !== 'off') act('repeat', $('#dock'));
    assert(new Set(seen).size === 3, `saw ${seen}`);
  });
  await test('player', 'repeat one restarts the song when it ends', async () => {
    while (E.repeat !== 'one') act('repeat', $('#dock'));
    const i = E.i;
    E.seek(Math.max(0, E.duration - 2));
    await until(() => E.time < 5 && E.i === i, 12000);
    while (E.repeat !== 'off') act('repeat', $('#dock'));
  });
  await test('player', 'like and unlike', async () => {
    const before = JSON.parse(localStorage.getItem('hum:liked') || '[]').length;
    act('like', $('#dock'));
    await sleep(500);
    const mid = JSON.parse(localStorage.getItem('hum:liked') || '[]').length;
    act('like', $('#dock'));
    await sleep(500);
    const after = JSON.parse(localStorage.getItem('hum:liked') || '[]').length;
    assert(Math.abs(mid - before) === 1 && after === before, `${before} ${mid} ${after}`);
  });
  await test('player', 'mute and unmute', async () => {
    const v = E.volume;
    act('mute', $('#np'));
    assert(E.volume === 0, 'not muted');
    assert($('.js-mute').innerHTML.includes('m22 9'), 'mute icon not shown');
    act('mute', $('#np'));
    assert(E.volume > 0 && Math.abs(E.volume - (v || E.lastVolume)) < 0.01, 'volume not restored');
  });
  await test('player', 'volume slider sets the volume', async () => {
    const r = $('#np .js-volume');
    const v = E.volume;
    r.value = 0.4;
    r.dispatchEvent(new Event('input'));
    assert(Math.abs(E.volume - 0.4) < 0.01 && r.style.getPropertyValue('--v') === '0.4', 'slider ignored');
    r.value = v;
    r.dispatchEvent(new Event('input'));
  });
  await test('player', 'progress bar seeks where you click', async () => {
    await until(() => E.duration > 30, 8000);
    const bar = $('#dock .bar') && $('#dock .bar').offsetParent ? $('#dock .bar') : $('#np .bar');
    if (!bar.offsetParent) act('open');
    await sleep(300);
    const target = bar.offsetParent ? bar : $('#np .bar');
    const r = target.getBoundingClientRect();
    const x = r.left + r.width * 0.5, y = r.top + r.height / 2;
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    await sleep(900);
    assert(Math.abs(E.time - E.duration / 2) < 6, `at ${E.time} of ${E.duration}`);
    if (document.body.classList.contains('np-open')) act('close');
  });
  await test('player', 'arrow keys on the bar skip 5 seconds', async () => {
    const t = E.time;
    $('#np .bar').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(600);
    assert(E.time - t > 3, `moved ${E.time - t}`);
  });
  await test('player', 'end of queue with autoplay off says so', async () => {
    const saved = { list: E.list, i: E.i, autoplay: E.autoplay };
    let notice = '';
    const on = (e) => (notice = e.detail);
    E.addEventListener('notice', on);
    E.list = [E.current];
    E.i = 0;
    E.next();
    E.removeEventListener('notice', on);
    Object.assign(E, saved);
    assert(/last song/i.test(notice), `notice: ${notice}`);
  });

  // ---------------- now playing, tabs, queue ----------------
  await test('now playing', 'opens and closes', async () => {
    act('open');
    await sleep(500);
    assert(document.body.classList.contains('np-open'), 'did not open');
    act('close');
    await sleep(500);
    assert(!document.body.classList.contains('np-open'), 'did not close');
  });
  await test('now playing', 'tabs switch between lyrics and up next', async () => {
    act('open');
    await sleep(300);
    $('.tabs [data-tab="queue"]').click();
    await sleep(200);
    assert(!$('#queue').hidden && $('#lyrics').hidden && $('.tabs').dataset.on === 'queue', 'queue tab');
    $('.tabs [data-tab="lyrics"]').click();
    await sleep(200);
    assert($('#queue').hidden && !$('#lyrics').hidden, 'lyrics tab');
  });
  await test('now playing', 'lyrics load or say there are none', async () => {
    await until(() => ['synced', 'plain', 'none'].includes($('#lyrics').dataset.mode), 8000);
  });
  await test('now playing', 'queue jump plays the chosen song', async () => {
    $('.tabs [data-tab="queue"]').click();
    await sleep(200);
    const row = $$('#queue .q-row:not(.now)')[1];
    const title = row.querySelector('b').textContent;
    row.click();
    await until(() => E.current.title === title);
  });
  await test('now playing', 'removing from the queue works', async () => {
    const n = E.list.length;
    $('#queue [data-q-remove]').click();
    await sleep(200);
    assert(E.list.length === n - 1, 'not removed');
    act('close');
    await sleep(400);
  });
  await test('now playing', 'share builds a /s/ link', async () => {
    let copied = '';
    const real = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (navigator.clipboard) navigator.clipboard.writeText = async (t) => (copied = t);
    act('share', $('#np'));
    await sleep(300);
    if (real) navigator.clipboard.writeText = real;
    assert(new RegExp(`^${location.origin}/s/[\\w-]{11}$`).test(copied), `copied ${copied}`);
  });

  await test('now playing', 'tab highlight sits exactly under the active tab', async () => {
    act('open');
    await sleep(400);
    for (const tab of ['queue', 'lyrics']) {
      $(`.tabs [data-tab="${tab}"]`).click();
      await sleep(600);
      const b = $(`.tabs [data-tab="${tab}"]`).getBoundingClientRect(), ink = $('.tab-ink').getBoundingClientRect();
      assert(Math.abs(b.left - ink.left) < 1.5 && Math.abs(b.width - ink.width) < 1.5, `${tab}: ink ${Math.round(ink.left)}+${Math.round(ink.width)} vs ${Math.round(b.left)}+${Math.round(b.width)}`);
    }
    act('close');
    await sleep(400);
  });

  // ---------------- notch ----------------
  const notchWas = document.body.classList.contains('notch');
  await test('notch', 'N turns notch mode on and the island shows the song', async () => {
    if (notchWas) press('n');
    press('n');
    await sleep(800);
    assert(document.body.classList.contains('notch') && getComputedStyle($('#island')).display === 'block', 'island not shown');
    assert($('.isl-line').textContent.trim().length > 0, 'island is empty');
    assert(getComputedStyle($('#dock')).opacity === '0', 'bottom bar still visible');
  });
  await test('notch', 'island opens and its play button works', async () => {
    $('.isl-compact').click();
    await sleep(700);
    assert($('#island').classList.contains('open') && $('#island').getBoundingClientRect().height > 150, 'did not open');
    const p = E.playing;
    $('#island [data-act="toggle"]').click();
    await until(() => E.playing !== p, 6000);
    $('#island [data-act="toggle"]').click();
    await until(() => E.playing === p, 8000);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(500);
    assert(!$('#island').classList.contains('open'), 'did not close on outside tap');
  });
  await test('notch', 'island never covers the search box', async () => {
    await go('#/search/arijit', 1500);
    const a = $('#island').getBoundingClientRect(), b = $('.search').getBoundingClientRect();
    assert(a.bottom <= b.top + 1, `island bottom ${Math.round(a.bottom)} > search top ${Math.round(b.top)}`);
    await go('#/', 600);
  });
  await test('notch', 'switching back restores the bottom bar', async () => {
    press('n');
    await sleep(700);
    assert(!document.body.classList.contains('notch') && getComputedStyle($('#dock')).opacity === '1', 'bar not back');
    if (notchWas) press('n');
  });

  // ---------------- keyboard ----------------
  await test('keyboard', '/ focuses search', async () => {
    press('/');
    await sleep(100);
    assert(document.activeElement === $('#q'), 'not focused');
    $('#q').blur();
  });
  await test('keyboard', 'L opens lyrics and Escape closes', async () => {
    press('l');
    await sleep(400);
    assert(document.body.classList.contains('np-open') && !$('#lyrics').hidden, 'lyrics not open');
    press('Escape');
    await sleep(400);
    assert(!document.body.classList.contains('np-open'), 'still open');
  });
  await test('keyboard', 'M mutes, S shuffles, space pauses', async () => {
    const v = E.volume, s = E.shuffle;
    press('m');
    assert(E.volume === 0, 'm');
    press('m');
    press('s');
    assert(E.shuffle === !s, 's');
    press('s');
    const p = E.playing;
    press(' ');
    await until(() => E.playing !== p);
    press(' ');
    await until(() => E.playing === p, 8000);
    assert(Math.abs(E.volume - v) < 0.01, 'volume changed');
  });

  // ---------------- playlists and library ----------------
  const album = JSON.parse(localStorage.getItem('hum:playlists') || '[]').find((p) => p.kind === 'album');
  await test('library', 'playlist play button plays from the top', async () => {
    await go(`#/pl/${encodeURIComponent(album.id)}`, 900);
    act('play-pl');
    await until(() => E.ctx.name === album.name && E.i === 0, 8000);
  });
  await test('library', 'row plus queues the song next', async () => {
    const title = $('#view [data-row-queue="5"]').closest('.row').querySelector('b').textContent;
    $('#view [data-row-queue="5"]').click();
    await sleep(200);
    assert(E.list[E.i + 1].title === title, 'not next');
  });
  await test('library', 'row heart adds to Liked and the Liked page shows it', async () => {
    $('#view [data-row-like="3"]').click();
    await sleep(500);
    const t = album.tracks[3];
    await go('#/liked', 800);
    assert($('#view').textContent.includes(t.title), 'not on liked page');
    $('#view [data-row-like="0"]').click();
    await sleep(400);
  });
  await test('library', 'shuffle play keeps every song', async () => {
    await go(`#/pl/${encodeURIComponent(album.id)}`, 800);
    act('shuffle-pl');
    await until(() => E.ctx.name === album.name);
    assert(E.list.length >= album.tracks.length, 'lost songs');
  });
  await test('library', 'deleting a playlist removes it and goes home', async () => {
    act('delete-pl');
    await sleep(800);
    const left = JSON.parse(localStorage.getItem('hum:playlists') || '[]');
    assert(!left.some((p) => p.id === album.id) && document.body.classList.contains('home'), 'not deleted');
  });
  await test('library', 'missing playlist and unknown route are handled', async () => {
    await go('#/pl/does-not-exist', 600);
    assert(/not in your library/.test($('#view').textContent), 'no message');
    await go('#/whatever/else', 600);
    assert($('.stations'), 'unknown route did not fall back home');
  });
  await test('library', 'station starts an endless mix', async () => {
    await go('#/', 600);
    $('[data-station="1"]').click();
    await until(() => E.ctx.name === 'Lo-fi Focus' && E.list.length > 10, 10000);
  });

  // ---------------- looks ----------------
  await test('looks', 'every visible button has an icon or label', async () => {
    const bad = $$('button').filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' && !b.querySelector('svg') && !b.textContent.trim());
    assert(!bad.length, bad.map((b) => b.dataset.act || b.className).join(', '));
  });
  await test('looks', 'every icon-only button has an accessible name', async () => {
    const bad = $$('button').filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && b.getClientRects().length);
    assert(!bad.length, bad.map((b) => b.dataset.act || b.className).join(', '));
  });
  await test('looks', 'no broken pictures', async () => {
    await go('#/search/the weeknd', 2500);
    await sleep(2500);
    const broken = $$('img').filter((i) => i.complete && i.naturalWidth === 0 && i.getClientRects().length && i.src);
    assert(!broken.length, `${broken.length} broken: ${broken[0]?.src.slice(0, 60)}`);
  });
  await test('looks', 'pictures fade in over a shimmer', async () => {
    const imgs = $$('#view .row-art img');
    assert(imgs.length && imgs.every((i) => i.classList.contains('ok') || !i.complete), 'image loaded without fade class');
  });
  await test('looks', 'song preview appears on hover', async () => {
    const row = $('#view .row[data-play="2"]');
    const r = row.getBoundingClientRect();
    row.querySelector('b').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.left + 100, clientY: r.top + 10 }));
    await until(() => $('#peek').classList.contains('on'), 2000);
    $('#view').dispatchEvent(new PointerEvent('pointerleave'));
  });
  await test('looks', 'favicon shows the cover while playing', async () => {
    await until(() => E.playing, 8000);
    await sleep(600);
    assert($('link[rel="icon"]').href.startsWith('data:image/png'), 'favicon not live');
  });

  // ---------------- sync ----------------
  // Pure checks. Nothing here touches the network or the real library: the engine runs on
  // in-memory stores and a fake server that follows the same rules as /api/sync.
  const S = await import('/sync.js');
  const track = (title, artist = 'Artist', id) => ({ ...(id && { id }), title, artist, album: '', duration: 200, art: '' });
  const memStore = (init = {}) => {
    const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
    return { get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), set: (k, v) => m.set(k, JSON.stringify(v)) };
  };
  const fakeServer = () => {
    const rows = new Map();
    const fetch = async (url, init = {}) => {
      const path = url.replace('/api/sync', '').split('?')[0].slice(1);
      const since = new URL(url, 'http://x').searchParams.get('since');
      if (!path) return new Response('{}', { status: 200 });
      const row = rows.get(path);
      if (!init.method || init.method === 'GET') {
        if (!row) return new Response('{}', { status: 404 });
        if (since === String(row.version)) return new Response(null, { status: 204, headers: { 'X-Sync-Version': String(row.version) } });
        return new Response(row.data, { status: 200, headers: { 'X-Sync-Version': String(row.version) } });
      }
      const from = Number(init.headers['X-Sync-Base']);
      if ((row?.version || 0) !== from) return new Response('{}', { status: 409 });
      rows.set(path, { data: new Uint8Array(init.body), version: from + 1 });
      return new Response(JSON.stringify({ version: from + 1 }), { status: 200 });
    };
    return { rows, fetch };
  };

  await test('sync', 'a sync code round trips and catches typos', async () => {
    const secret = S.makeSecret();
    const code = await S.codeFromSecret(secret);
    assert(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/.test(code), `shape ${code}`);
    const back = await S.secretFromCode(code.toLowerCase().replaceAll('-', ' '));
    assert(back.length === 16 && back.every((b, i) => b === secret[i]), 'did not round trip');
    const typo = code.replace(/^./, (c) => (c === '2' ? '3' : '2'));
    let failed = false;
    await S.secretFromCode(typo).catch(() => (failed = true));
    assert(failed, 'a typo slipped through');
    failed = false;
    await S.secretFromCode(code.slice(0, 20)).catch(() => (failed = true));
    assert(failed, 'short code accepted');
  });
  await test('sync', 'key derivation is deterministic and the id differs from the key', async () => {
    const secret = S.makeSecret();
    const a = await S.deriveKeys(secret), b = await S.deriveKeys(secret), c = await S.deriveKeys(S.makeSecret());
    assert(a.id === b.id && /^[A-Za-z0-9_-]{43}$/.test(a.id), 'id not stable');
    assert(a.id !== c.id, 'two codes share an id');
    const doc = { v: 1, liked: [track('x')] };
    assert(JSON.stringify(await S.open(b, await S.seal(a, doc))) === JSON.stringify(doc), 'key from the same secret cannot open it');
  });
  await test('sync', 'encrypt and decrypt round trip, and a wrong code fails', async () => {
    const k = await S.deriveKeys(S.makeSecret());
    const doc = { v: 1, liked: [track('Secret Song', 'Hidden Artist', 'abc12345678')], taste: { n: 1 } };
    const blob = await S.seal(k, doc);
    assert(JSON.stringify(await S.open(k, blob)) === JSON.stringify(doc), 'round trip changed the data');
    const text = new TextDecoder('latin1').decode(blob);
    assert(!text.includes('Secret Song') && !text.includes('Hidden Artist') && !text.includes('liked'), 'plaintext visible in the blob');
    const other = await S.deriveKeys(S.makeSecret());
    let kind = '';
    await S.open({ id: k.id, key: other.key }, blob).catch((e) => (kind = e.kind));
    assert(kind === 'wrong', 'wrong key decrypted');
    kind = '';
    await S.open({ id: other.id, key: k.key }, blob).catch((e) => (kind = e.kind));
    assert(kind === 'wrong', 'blob opened under a different id');
    const bent = blob.slice();
    bent[bent.length - 3] ^= 1;
    kind = '';
    await S.open(k, bent).catch((e) => (kind = e.kind));
    assert(kind === 'wrong', 'tampered blob accepted');
  });
  await test('sync', 'liked merges by union, and a removal beats an older add', async () => {
    const a = S.buildDoc({ liked: [track('A'), track('B'), track('C')] }, undefined, 1000).doc;
    const b = S.buildDoc({ liked: [track('B'), track('D')] }, undefined, 1500).doc;
    const m = S.mergeDocs(a, b, 2000);
    assert(['a|artist', 'b|artist', 'c|artist', 'd|artist'].every((k) => m.liked.some((t) => S.trackKey(t) === k)) && m.liked.length === 4, 'not a union');
    const un = S.buildDoc({ liked: [track('A'), track('C')] }, S.metaFromDoc(m), 3000).doc;
    assert(!S.mergeDocs(m, un, 4000).liked.some((t) => t.title === 'B'), 'removed song came back');
    assert(!S.mergeDocs(un, m, 4000).liked.some((t) => t.title === 'B'), 'merge order mattered');
    const again = S.buildDoc({ liked: [track('B'), ...S.docValues(un).liked] }, S.metaFromDoc(un), 5000).doc;
    assert(S.mergeDocs(m, again, 6000).liked.some((t) => t.title === 'B'), 'a later like did not revive it');
    const withId = S.buildDoc({ liked: [track('A', 'Artist', 'vid00000001')] }, undefined, 1000).doc;
    assert(S.mergeDocs(a, withId, 2000).liked.filter((t) => t.title === 'A').length === 1, 'the same song twice');
  });
  await test('sync', 'playlists merge by id, newest edit wins, a delete beats an older edit', async () => {
    const p = (id, name, n) => ({ id, name, tracks: Array.from({ length: n }, (_, i) => track(`t${i}`)) });
    const a = S.buildDoc({ playlists: [p('p1', 'Mine', 1), p('p2', 'Gym', 1)] }, undefined, 1000);
    const b = S.buildDoc({ playlists: [p('p1', 'Mine', 1), p('p3', 'New', 2)] }, undefined, 1000);
    const bEdit = S.buildDoc({ playlists: [p('p1', 'Mine v2', 3), p('p3', 'New', 2)] }, b.meta, 5000).doc;
    const m = S.mergeDocs(a.doc, bEdit, 6000);
    assert(m.playlists.length === 3, `${m.playlists.length} playlists`);
    assert(m.playlists.find((x) => x.id === 'p1').name === 'Mine v2', 'newest edit lost');
    const del = S.buildDoc({ playlists: [p('p1', 'Mine v2', 3), p('p3', 'New', 2)] }, S.metaFromDoc(m), 7000).doc;
    const gone = S.mergeDocs(m, del, 8000);
    assert(!gone.playlists.some((x) => x.id === 'p2') && gone.playlists.length === 2, 'delete did not stick');
    const byId = (l) => S.stable([...l].sort((x, y) => x.id.localeCompare(y.id)));
    assert(byId(S.mergeDocs(del, m, 8000).playlists) === byId(gone.playlists), 'merge order mattered');
  });
  await test('sync', 'recent merges by time and keeps 30', async () => {
    const mk = (prefix, n, t0) => S.buildDoc({ recent: Array.from({ length: n }, (_, i) => track(`${prefix}${i}`)) }, undefined, t0).doc;
    const m = S.mergeDocs(mk('a', 25, 1000), mk('b', 25, 90000), 100000);
    assert(m.recent.length === 30, `${m.recent.length} kept`);
    assert(m.recent[0].title === 'b0' && m.recent.slice(0, 25).every((t) => t.title.startsWith('b')), 'newest plays should lead');
  });
  await test('sync', 'taste takes the max per counter and variants keep the newest per playlist', async () => {
    const t = S.mergeTaste({ x: { plays: 3, last: 100, skips: 1 }, y: { plays: 1 } }, { x: { plays: 2, last: 250, skips: 4 }, z: { plays: 5 } });
    assert(t.x.plays === 3 && t.x.last === 250 && t.x.skips === 4 && t.y.plays === 1 && t.z.plays === 5, JSON.stringify(t));
    assert(S.stable(S.mergeTaste(t, { x: { plays: 1 } })) === S.stable(t), 'not idempotent');
    const v = S.mergeVariants({ p1: { at: 10, n: 'old' }, p2: { at: 5, n: 'only here' } }, { p1: { at: 20, n: 'new' } });
    assert(v.p1.n === 'new' && v.p2.n === 'only here', JSON.stringify(v));
    assert(S.mergeTaste(undefined, undefined) === undefined && S.mergeVariants(undefined, { a: 1 }).a === 1, 'absent values broke the merge');
    const doc = S.mergeDocs(S.buildDoc({ liked: [] }, undefined, 1).doc, S.buildDoc({ liked: [], taste: { a: { n: 1 } } }, undefined, 1).doc, 2);
    assert(doc.taste.a.n === 1 && !('variants' in doc), 'absent keys should stay absent');
  });
  await test('sync', 'a merged document diffs to itself, so an idle device never pushes', async () => {
    const vals = { liked: [track('A', 'x', 'id000000001'), track('B')], playlists: [{ id: 'p', name: 'P', tracks: [track('A')] }], recent: [track('A'), track('B')] };
    const one = S.buildDoc(vals, undefined, 1000).doc;
    const two = S.buildDoc(S.docValues(one), S.metaFromDoc(one), 90000).doc;
    assert(S.stable(one) === S.stable(two), 'diff invented a change');
  });
  await test('sync', 'two devices converge through a server that only holds ciphertext', async () => {
    const srv = fakeServer();
    const A = memStore({ liked: [track('One'), track('Two')], playlists: [{ id: 'pl1', name: 'Road', tracks: [track('One')] }], recent: [track('One')] });
    const B = memStore();
    const a = S.createSync({ store: A, fetch: srv.fetch, snapshot: () => '' });
    const b = S.createSync({ store: B, fetch: srv.fetch, snapshot: () => '' });
    const code = await a.enable();
    await until(() => a.info.lastSynced && a.info.phase === 'idle', 4000);
    assert(srv.rows.size === 1, 'nothing stored');
    const [[id, row]] = [...srv.rows];
    assert(!/One|Road|liked/.test(new TextDecoder('latin1').decode(row.data)) && id.length === 43, 'server could read it');
    await b.join(code);
    await until(() => b.info.phase === 'idle' && B.get('liked', []).length === 2, 4000);
    assert(B.get('playlists', [])[0]?.name === 'Road' && B.get('recent', []).length === 1, 'B did not receive everything');
    B.set('liked', [track('Three'), ...B.get('liked', [])]);
    await b.now();
    await a.now();
    assert(A.get('liked', []).some((t) => t.title === 'Three'), 'A did not get B’s like');
    A.set('liked', A.get('liked', []).filter((t) => t.title !== 'Two'));
    A.set('playlists', []);
    await a.now();
    await b.now();
    assert(!B.get('liked', []).some((t) => t.title === 'Two') && B.get('playlists', []).length === 0, 'removals did not travel');
    const c = S.createSync({ store: memStore(), fetch: srv.fetch, snapshot: () => '' });
    let kind = '';
    await c.join(await S.codeFromSecret(S.makeSecret())).catch((e) => (kind = e.kind));
    assert(kind === 'missing' && !c.on, 'a wrong code found something or turned sync on');
    a.disable();
    b.disable();
    assert(!a.on && A.get('liked', []).length === 2, 'turning off should keep local data');
  });
  await test('sync', 'a stale device retries after a conflict instead of overwriting', async () => {
    const srv = fakeServer();
    const A = memStore({ liked: [track('A1')] });
    const B = memStore();
    const a = S.createSync({ store: A, fetch: srv.fetch, snapshot: () => '' });
    let race = false, conflicts = 0;
    // The first time B writes, A gets in ahead of it, so B's version is stale and the server says 409.
    const bFetch = async (u, init) => {
      if (init?.method === 'PUT' && race) (race = false, await a.now());
      const res = await srv.fetch(u, init);
      if (res.status === 409) conflicts++;
      return res;
    };
    const b = S.createSync({ store: B, fetch: bFetch, snapshot: () => '' });
    const code = await a.enable();
    await until(() => a.info.lastSynced, 4000);
    await b.join(code);
    await until(() => B.get('liked', []).length === 1 && b.info.phase === 'idle', 4000);
    A.set('liked', [track('A2'), ...A.get('liked', [])]);
    B.set('liked', [track('B2'), ...B.get('liked', [])]);
    race = true;
    await b.now();
    await a.now();
    assert(conflicts === 1, `expected one conflict, saw ${conflicts}`);
    const keys = (s) => s.get('liked', []).map((t) => t.title).sort().join();
    assert(keys(A) === 'A1,A2,B2' && keys(B) === 'A1,A2,B2', `${keys(A)} / ${keys(B)}`);
    a.disable();
    b.disable();
  });
  await test('sync', 'a backup file is checked before it is merged in', async () => {
    let kind = '';
    try { S.parseBackup({ liked: [] }); } catch (e) { kind = e.kind; }
    assert(kind === 'file', 'accepted a random file');
    const ok = S.parseBackup({ hum: 'library', liked: [track('Fine'), 'junk', null], playlists: [{ id: 'p', tracks: [track('x'), 5] }, { name: 'no id' }], recent: 'nope' });
    assert(ok.liked.length === 1 && ok.playlists.length === 1 && ok.playlists[0].tracks.length === 1 && ok.recent.length === 0, JSON.stringify(ok));
    const st = memStore({ liked: [track('Mine')] });
    const e = S.createSync({ store: st, fetch: async () => new Response('', { status: 501 }), snapshot: () => '' });
    e.importLibrary({ hum: 'library', liked: [track('Theirs')], playlists: [], recent: [] });
    assert(st.get('liked', []).length === 2 && st.get('liked', [])[0].title === 'Mine', 'import should add, not replace');
    const out = e.exportLibrary();
    assert(out.hum === 'library' && out.liked.length === 2, 'export lost songs');
  });
  await go('#/', 600);
  await test('sync', 'the entry shows Sync when the server supports it and Backup when not', async () => {
    const status = (await fetch('/api/sync')).status;
    await until(() => $('[data-sync="open"]'), 4000);
    const label = $('[data-sync="open"]').textContent.trim();
    assert(label === (status === 200 ? 'Sync' : 'Backup'), `${status} but the entry says ${label}`);
  });
  await test('sync', 'the sheet opens, offers backup, and closes with Escape', async () => {
    $('[data-sync="open"]').click();
    await until(() => !$('.sync-back').hidden, 2000);
    assert($('[data-sync="export"]') && $('[data-sync="import"]'), 'no backup buttons');
    $('.sync-sheet').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => $('.sync-back').hidden, 2000);
  });

  // ---------------- server ----------------
  await test('server', 'share page carries preview tags', async () => {
    const html = await (await fetch(`/s/${E.current.playId || E.current.id}`)).text();
    assert(html.includes('og:image') && html.includes('og:title') && html.includes('location.replace'), 'missing tags');
  });
  await test('server', 'local remote control answers', async () => {
    const s = await (await fetch('/api/remote/state')).json();
    assert(s.connected >= 1 && s.track, 'no state');
  });
  await test('server', 'remote refuses non-JSON posts', async () => {
    const r = await fetch('/api/remote', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"cmd":"pause"}' });
    assert(r.status === 415, `status ${r.status}`);
  });

  // ---------------- widget ----------------
  await test('widget', 'widget search and play work', async () => {
    const f = document.createElement('iframe');
    f.src = '/widget.html';
    f.style.cssText = 'position:fixed;left:-2000px;top:0;width:360px;height:520px';
    document.body.append(f);
    await until(() => f.contentDocument?.querySelector('#wq') && f.contentWindow.document.readyState === 'complete', 8000);
    await sleep(800);
    const wq = f.contentDocument.querySelector('#wq');
    wq.value = 'kesariya';
    wq.dispatchEvent(new Event('input'));
    await until(() => f.contentDocument.querySelectorAll('.w-row').length > 3, 8000);
    f.contentDocument.querySelector('.w-row').click();
    await until(() => /Kesariya/i.test(f.contentDocument.querySelector('.w-title').textContent), 8000);
    f.remove();
  });

  removeEventListener('error', onErr);
  removeEventListener('unhandledrejection', onErr);
  console.error = origError;
  results.push({ area: 'console', name: 'no errors during the whole run', ok: !errors.length, why: errors.slice(0, 3).join(' | ') });
  await go('#/', 300);
  return results;
}
