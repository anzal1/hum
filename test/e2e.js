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

  // ---------------- taste and For you ----------------
  const T = await import('/taste.js');
  const { keyOf, nameKey } = await import('/engine.js');
  const H = window.__hum;
  const NOW = Date.UTC(2026, 9, 5, 10);
  const saved = { taste: localStorage.getItem('hum:taste'), variants: localStorage.getItem('hum:variants'), playlists: H.lib.playlists, clock: T.clock.now };
  const mk = (p, n, extra = {}) => ({ id: `${p}${String(n).padStart(2, '0')}`, title: `${p} song ${n}`, artist: `${p} artist ${n % 4}`, album: `${p} album`, duration: 200, ...extra });
  const mkList = (p, n) => Array.from({ length: n }, (_, i) => mk(p, i));
  const stat = (t, o = {}) => ({ plays: 1, completes: 0, skips: 0, firstSeen: NOW, lastPlayed: NOW, nk: nameKey(t), track: t, ...o });
  const tasteOf = (pairs) => ({ tracks: Object.fromEntries(pairs.map(([t, o]) => [keyOf(t), stat(t, o)])), uses: {} });
  const day = (d) => T.dayKey(new Date(2026, 9, d, 10));
  const json = (v) => Promise.resolve(new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }));
  // Answers search and radio for made-up songs, so nothing here depends on YouTube.
  const mockApi = ({ search, radio }) => {
    const real = window.fetch;
    window.fetch = (u, ...a) => {
      const url = new URL(String(u), location.href);
      const hit = url.pathname === '/api/radio' ? radio(url.searchParams.get('id')) : url.pathname === '/api/search' && search ? search(url.searchParams.get('q')) : null;
      return hit ? json(hit) : real(u, ...a);
    };
    return () => (window.fetch = real);
  };
  const generic = (id, n = 15) => mkList(`${id}~`, n);
  const home = async () => {
    await go('#/liked', 250);
    await go('#/', 700);
  };
  const resetTaste = () => {
    localStorage.removeItem('hum:taste');
    localStorage.removeItem('hum:variants');
  };

  try {
    await test('taste', 'score: like +4, finish +1, replay +1.5, early skip -2, unknown 0', async () => {
      const at = (o, liked = false) => T.score(stat(mk('sc', 1), o), { liked, now: NOW });
      assert(T.score(undefined, { now: NOW }) === 0 && T.score({}, { liked: false, now: NOW }) === 0, 'unknown is not 0');
      assert(at({}, true) - at({}) === 4, 'like');
      assert(at({ plays: 1, completes: 1 }) === 1 && at({ plays: 1, completes: 3 }) === 3, 'complete');
      assert(at({ plays: 1, completes: 40 }) === 5, 'completes not capped');
      assert(at({ plays: 3 }) === 3 && at({ plays: 99 }) === 4.5, 'replay');
      assert(at({ skips: 1 }) === -2 && at({ skips: 2 }) === -4, 'skip');
    });
    await test('taste', 'score fades with time: half after 45 days, liked songs too', async () => {
      const old = stat(mk('sc', 2), { completes: 4, lastPlayed: NOW - 45 * 86400000 });
      assert(Math.abs(T.score(old, { now: NOW }) - 2) < 1e-9, `got ${T.score(old, { now: NOW })}`);
      assert(Math.abs(T.score(old, { liked: true, now: NOW }) - 4) < 1e-9, 'like not faded with the rest');
      assert(T.score(old, { now: NOW }) < T.score({ ...old, lastPlayed: NOW - 86400000 }, { now: NOW }), 'older not lower');
    });
    await test('taste', 'early skip means before 30 s or 25%, whichever is smaller', async () => {
      const sk = (time, duration, exit = 'skip') => T.judge({ time, duration, exit }).skip;
      assert(sk(29, 300) && !sk(31, 300), '30 s on a long song');
      assert(sk(24, 100) && !sk(26, 100), '25% on a short song');
      assert(sk(10, 0), 'unknown length uses 30 s');
      assert(!sk(10, 300, 'switch') && !sk(10, 300, 'leave') && !sk(10, 300, 'error'), 'only a skip counts');
      assert(!sk(0.4, 300), 'nothing was heard');
      assert(T.skipLimit(100) === 25 && T.skipLimit(200) === 30, 'limit');
    });
    await test('taste', 'a listen is complete past 80% or at the end, and errors count for nothing', async () => {
      const j = (time, duration, exit = 'skip') => T.judge({ time, duration, exit });
      assert(j(161, 200).complete && !j(159, 200).complete, '80%');
      assert(j(5, 200, 'end').complete, 'end');
      assert(j(170, 200).complete && !j(170, 200).skip, 'finished song is no skip');
      const none = j(3, 200, 'error');
      assert(!none.play && !none.complete && !none.skip, 'error counted');
      assert(!j(0.2, 200).play, 'under a second is not a play');
    });
    await test('taste', 'listening to the engine records plays, finishes and early skips', async () => {
      const fake = Object.assign(new EventTarget(), { current: null, time: 0, player: { duration: 200 }, exit: 'switch', repeat: 'off', ctx: { name: 'Mix', key: 'tt-mix' } });
      let clockMs = NOW;
      const rec = T.attachListener(fake, { now: () => (clockMs += 1000) });
      const fire = (name) => fake.dispatchEvent(new CustomEvent(name));
      const listen = (t, time, exit, dur = 200) => {
        fake.current = t;
        fake.player.duration = dur;
        fire('started');
        fake.time = time;
        fake.exit = exit;
        fire('track'); // the first fire of the change judges the song that was playing
        fake.exit = 'switch';
      };
      const [a, b, c, d, e] = mkList('ls', 5);
      resetTaste();
      listen(a, 10, 'skip');
      listen(b, 170, 'skip');
      fake.current = c;
      fire('started');
      fake.time = 199.5;
      fire('ended');
      fire('track'); // the change that follows a natural end must not count twice
      listen(d, 45, 'skip');
      listen(e, 0, 'error');
      listen(a, 100, 'switch');
      rec.finish('switch');
      rec.stop();
      const got = T.loadTaste();
      const g = (t) => got.tracks[keyOf(t)];
      assert(g(a).plays === 2 && g(a).skips === 1 && g(a).completes === 0, `a ${JSON.stringify(g(a))}`);
      assert(g(b).plays === 1 && g(b).completes === 1 && g(b).skips === 0, 'b finished');
      assert(g(c).plays === 1 && g(c).completes === 1, `c ${JSON.stringify(g(c))}`);
      assert(g(d).plays === 1 && g(d).skips === 0 && g(d).completes === 0, 'd past 30 s is a play, not a skip');
      assert(!g(e), 'error counted');
      assert(got.uses['tt-mix']?.n === 5, `uses ${JSON.stringify(got.uses)}`);
      assert(JSON.parse(localStorage.getItem('hum:taste')).tracks[keyOf(a)].lastPlayed > NOW, 'lastPlayed not stored');
    });
    await test('taste', 'repeat one counts each pass as a finished play', async () => {
      const fake = Object.assign(new EventTarget(), { current: mk('rp', 0), time: 0, player: { duration: 100 }, exit: 'switch', repeat: 'one', ctx: {} });
      const rec = T.attachListener(fake, { now: () => NOW });
      resetTaste();
      fake.dispatchEvent(new CustomEvent('started'));
      for (let k = 0; k < 3; k++) {
        fake.time = 99;
        fake.dispatchEvent(new CustomEvent('ended'));
      }
      rec.stop();
      const e = T.loadTaste().tracks[keyOf(mk('rp', 0))];
      assert(e.plays === 3 && e.completes === 3, JSON.stringify(e));
    });
    await test('taste', 'only a slim copy of each song is kept, and only the 600 most recent', async () => {
      const t = { ...mk('cp', 1), duration: 99, radio: true, tried: ['x'], lyrics: 'long text' };
      const one = T.recordListen({ tracks: {}, uses: {} }, t, { play: true, complete: true, skip: false }, NOW);
      assert(Object.keys(one.tracks[keyOf(t)].track).sort().join() === 'album,art,artist,id,title', 'copy not slim');
      const big = { tracks: {}, uses: {} };
      for (let k = 0; k < 650; k++) T.recordListen(big, mk('cap', k), { play: true, complete: false, skip: false }, NOW + k * 1000);
      const keys = Object.keys(big.tracks);
      assert(keys.length === 600, `kept ${keys.length}`);
      assert(big.tracks[keyOf(mk('cap', 649))] && !big.tracks[keyOf(mk('cap', 0))] && big.tracks[keyOf(mk('cap', 50))], 'wrong ones dropped');
    });
    await test('taste', 'a song first known by name keeps one entry once it has an id', async () => {
      const named = { title: 'Name Only', artist: 'Someone' };
      const t = { tracks: {}, uses: {} };
      T.recordListen(t, named, { play: true, complete: true, skip: false }, NOW);
      T.recordListen(t, { ...named, id: 'tt-found1' }, { play: true, complete: false, skip: true }, NOW + 1);
      const keys = Object.keys(t.tracks);
      assert(keys.length === 1 && keys[0] === 'tt-found1' && t.tracks['tt-found1'].plays === 2 && t.tracks['tt-found1'].completes === 1, JSON.stringify(t));
    });

    // ---- variants ----
    await test('for you', 'playlist songs are ranked by taste, unknown ones keep their order, skipped go last', async () => {
      const own = mkList('rk', 10);
      const taste = tasteOf([
        [own[5], { plays: 3, completes: 3 }],
        [own[7], { skips: 1 }],
        [own[8], { skips: 2 }],
      ]);
      const liked = T.likedKeySet([own[2]]);
      const { list, finds } = T.composeVariant(own, undefined, { taste, liked, now: NOW });
      const ids = list.map((t) => t.id).join();
      assert(finds === 0 && ids === [5, 2, 0, 1, 3, 4, 6, 9, 7, 8].map((n) => own[n].id).join(), `order ${ids}`);
    });
    await test('for you', 'opens with 3 finds, adds up to 3 on each new day, never passes 30% of the list', async () => {
      const own = mkList('gw', 20);
      let calls = 0;
      const radio = async (id) => (calls++, mkList(`${id}x`, 30));
      let st;
      const open = async (d) => {
        const out = await T.growFinds({ own, state: st, taste: { tracks: {}, uses: {} }, liked: new Set(), today: day(d), now: NOW, radio, ensureId: async (t) => t.id });
        st = out.state;
        return out;
      };
      assert(T.findCap(20) === 8, `cap ${T.findCap(20)}`);
      let o = await open(5);
      assert(o.added === 3 && st.finds.length === 3 && st.lastGrown === day(5), `day 1: ${st.finds.length}`);
      const after1 = calls;
      o = await open(5);
      assert(o.added === 0 && st.finds.length === 3 && calls === after1, 'same day grew or fetched again');
      o = await open(6);
      assert(st.finds.length === 6, `day 2: ${st.finds.length}`);
      o = await open(7);
      assert(st.finds.length === 8, `day 3 stops at the cap: ${st.finds.length}`);
      const after3 = calls;
      o = await open(8);
      assert(st.finds.length === 8 && calls === after3, 'grew past the cap or fetched for nothing');
      const v = T.composeVariant(own, st, { taste: { tracks: {}, uses: {} }, liked: new Set(), now: NOW });
      assert(v.list.length === 28 && v.finds / v.list.length <= 0.3, `share ${v.finds}/${v.list.length}`);
      const o2 = await T.growFinds({ own, state: st, taste: { tracks: {}, uses: {} }, liked: new Set(), today: day(9), now: NOW, radio: async () => { throw new Error('offline'); }, ensureId: async (t) => t.id });
      assert(o2.added === 0 && o2.state.finds.length === 8, 'cap cases never touch the network');
    });
    await test('for you', 'a failed lookup keeps the day open to try again', async () => {
      const own = mkList('ft', 12);
      const bad = await T.growFinds({ own, state: undefined, taste: { tracks: {}, uses: {} }, liked: new Set(), today: day(5), now: NOW, radio: async () => { throw new Error('offline'); }, ensureId: async (t) => t.id });
      assert(bad.failed && bad.state.finds.length === 0 && !bad.state.lastGrown, 'marked the day as done');
      const good = await T.growFinds({ own, state: bad.state, taste: { tracks: {}, uses: {} }, liked: new Set(), today: day(5), now: NOW, radio: async (id) => mkList(`${id}x`, 10), ensureId: async (t) => t.id });
      assert(good.added === 3, `retry added ${good.added}`);
    });
    await test('for you', 'finds are drawn from the best-loved songs, or the first ones when nothing is known', async () => {
      const own = mkList('sd', 20);
      const seen = [];
      const radio = async (id) => (seen.push(id), mkList(`${id}x`, 10));
      const run = (taste, liked = new Set()) => T.growFinds({ own, state: undefined, taste, liked, today: day(5), now: NOW, radio, ensureId: async (t) => t.id });
      await run({ tracks: {}, uses: {} });
      assert(seen.join() === [0, 1, 2].map((n) => own[n].id).join(), `cold start used ${seen}`);
      seen.length = 0;
      await run(tasteOf([[own[11], { plays: 4, completes: 4 }], [own[6], { plays: 2, completes: 2 }], [own[3], { skips: 1 }]]), T.likedKeySet([own[15]]));
      assert(new Set(seen).size === 3 && [own[15], own[11], own[6]].every((t) => seen.includes(t.id)) && !seen.includes(own[3].id), `warm start used ${seen}`);
    });
    await test('for you', 'finds are woven through the list and tagged, not stacked at the end', async () => {
      const own = mkList('wv', 20);
      const finds = mkList('wvf', 3);
      const { list } = T.composeVariant(own, { finds, retired: [], lastGrown: day(5) }, { taste: { tracks: {}, uses: {} }, liked: new Set(), now: NOW });
      const at = list.map((t, i) => (t.find ? i : -1)).filter((i) => i >= 0);
      assert(list.length === 23 && at.length === 3, `${list.length} ${at}`);
      assert(at[0] >= 3 && at[2] <= list.length - 4 && at[1] - at[0] > 2 && at[2] - at[1] > 2, `positions ${at}`);
      assert(list.filter((t) => !t.find).every((t) => own.some((o) => o.id === t.id)), 'own songs changed');
    });
    await test('for you', 'finds skipped twice are retired for good and replaced, a once-skipped song is never chosen', async () => {
      const own = mkList('rt', 20);
      const mix = (id) => mkList(`${id}x`, 30);
      const empty = { tracks: {}, uses: {} };
      let o = await T.growFinds({ own, state: undefined, taste: empty, liked: new Set(), today: day(5), now: NOW, radio: async (id) => mix(id), ensureId: async (t) => t.id });
      const doomed = o.state.finds[0];
      const wary = mix(own[0].id)[1]; // the first mix would offer this next, but it was skipped once
      const taste = tasteOf([[doomed, { skips: 2, plays: 2 }], [wary, { skips: 1, plays: 1 }]]);
      const v = T.composeVariant(own, o.state, { taste, liked: new Set(), now: NOW });
      assert(!v.list.some((t) => t.id === doomed.id), 'skipped find still listed');
      o = await T.growFinds({ own, state: o.state, taste, liked: new Set(), today: day(5), now: NOW, radio: async (id) => mix(id), ensureId: async (t) => t.id });
      assert(o.retired === 1 && o.added === 1 && o.state.finds.length === 3, `retired ${o.retired} added ${o.added} now ${o.state.finds.length}`);
      assert(!o.state.finds.some((f) => f.id === wary.id), 'chose a song that was skipped');
      assert(o.state.retired.includes(doomed.id) && !o.state.finds.some((f) => f.id === doomed.id), 'not retired');
      for (let d = 6; d <= 9; d++) o = await T.growFinds({ own, state: o.state, taste, liked: new Set(), today: day(d), now: NOW, radio: async (id) => mix(id), ensureId: async (t) => t.id });
      const ids = o.state.finds.map((f) => f.id);
      assert(!ids.includes(doomed.id) && !ids.includes(wary.id) && ids.length === 8, `finds ${ids.length}`);
    });
    await test('for you', 'no duplicates: by id, by title and artist, within a mix or across mixes', async () => {
      const own = mkList('dp', 21);
      const pool = mkList('pool', 10);
      let n = 0;
      const radio = async () => [
        own[3], // already in the playlist
        { ...own[4], id: `other${n++}` }, // same song, another upload
        ...pool.map((t) => ({ ...t, id: `${t.id}-${n++}` })), // same names, new ids each time
        ...pool,
        ...pool.slice(0, 3),
      ];
      let st;
      for (let d = 5; d <= 9; d++) st = (await T.growFinds({ own, state: st, taste: { tracks: {}, uses: {} }, liked: new Set(), today: day(d), now: NOW, radio, ensureId: async (t) => t.id })).state;
      const { list } = T.composeVariant(own, st, { taste: { tracks: {}, uses: {} }, liked: new Set(), now: NOW });
      const ids = list.map(keyOf), names = list.map(nameKey);
      assert(st.finds.length === 9, `finds ${st.finds.length}`);
      assert(new Set(ids).size === ids.length && new Set(names).size === names.length, 'duplicate in the list');
    });
    await test('for you', 'a find that joins the playlist stops being a find', async () => {
      const own = mkList('jn', 14);
      const f = mk('jnf', 1);
      const v = T.composeVariant([...own, f], { finds: [f, mk('jnf', 2)], retired: [], lastGrown: day(5) }, { taste: { tracks: {}, uses: {} }, liked: new Set(), now: NOW });
      assert(v.finds === 1 && v.list.filter((t) => keyOf(t) === keyOf(f)).length === 1 && !v.list.find((t) => keyOf(t) === keyOf(f)).find, 'listed twice or still tagged');
    });

    // ---- the switch and the pages ----
    const plId = 'sp-playlist-tt';
    const pl = { id: plId, name: 'Taste test', source: 'spotify', tracks: mkList('ui', 14) };
    const restoreApi = mockApi({ radio: (id) => (/^(ui|st)/.test(id) ? (id === 'st00' ? mkList('stm', 30) : generic(id)) : /^h[a-e]\d/.test(id) ? [] : null), search: (q) => (q === 'Blinding Lights The Weeknd' ? [mk('st', 0)] : null) });
    try {
      H.lib.playlists = [pl, ...saved.playlists];
      resetTaste();
      T.clock.now = () => new Date(2026, 9, 5, 10);
      const tags = () => $$('#view .find-tag');
      const rowsOf = () => $$('#view .row[data-play]').map((r) => $('.row-text b', r).textContent);
      let got;
      const spy = (name) => {
        E[name] = (...a) => ((got = a), Promise.resolve());
        return () => delete E[name];
      };

      await test('for you', 'playlists show an Original and For you switch, Original first', async () => {
        await go(`#/pl/${plId}`, 900);
        const seg = $('#view .seg');
        const labels = $$('button', seg).map((b) => b.textContent.trim());
        assert(labels.join() === 'Original,For you', labels.join());
        assert($('button.on', seg).textContent.trim() === 'Original', 'not on Original');
        assert(!tags().length && !/Learns from/.test($('#view').textContent), 'For you bits in Original');
        assert(rowsOf().join() === pl.tracks.map((t) => t.title).join(), 'Original reordered');
      });
      await test('for you', 'For you explains itself and shows new finds, tagged', async () => {
        act('foryou-on');
        await until(() => tags().length === 3, 6000);
        assert(location.hash === `#/pl/${plId}?for-you`, location.hash);
        assert($('#view .seg button.on').textContent.trim() === 'For you', 'switch not on For you');
        assert($('#view .fy-note').textContent === 'Learns from what you finish, skip and like. Grows a little each day.', 'explainer');
        assert(tags().every((t) => t.textContent === 'new for you'), 'tag text');
        assert($$('#view .row[data-play]').length === 17, `rows ${$$('#view .row[data-play]').length}`);
        await sleep(700);
        const ink = $('#view .seg-ink').getBoundingClientRect(), on = $('#view .seg button.on').getBoundingClientRect();
        assert(Math.abs(ink.left - on.left) < 1.5 && Math.abs(ink.width - on.width) < 1.5, 'switch highlight is not under the active side');
      });
      await test('for you', 'the buildup is remembered under variants, keyed by playlist', async () => {
        const v = JSON.parse(localStorage.getItem('hum:variants'));
        assert(v[plId].finds.length === 3 && v[plId].lastGrown === '2026-10-05' && Array.isArray(v[plId].retired), JSON.stringify(v).slice(0, 200));
      });
      await test('for you', 'switching back and forth on the same day adds nothing', async () => {
        act('foryou-off');
        await sleep(300);
        assert(!tags().length && location.hash === `#/pl/${plId}`, 'Original still shows finds');
        act('foryou-on');
        await until(() => tags().length === 3, 4000);
        await sleep(600);
        assert(tags().length === 3 && JSON.parse(localStorage.getItem('hum:variants'))[plId].finds.length === 3, 'grew on the same day');
      });
      await test('for you', 'opening on a new day adds a few more', async () => {
        T.clock.now = () => new Date(2026, 9, 6, 9);
        act('foryou-off');
        await sleep(200);
        act('foryou-on');
        await until(() => tags().length === 6, 6000);
        assert(JSON.parse(localStorage.getItem('hum:variants'))[plId].lastGrown === '2026-10-06', 'day not stored');
      });
      await test('for you', 'playing from For you plays the variant, as shown', async () => {
        const shownTitles = rowsOf();
        const done = spy('playList');
        $('#view .row[data-play="3"]').click();
        const [list, i, ctx] = got;
        done();
        assert(list.map((t) => t.title).join() === shownTitles.join(), 'queue is not the page');
        assert(i === 3 && list[3].title === shownTitles[3], 'wrong start row');
        assert(list.filter((t) => t.find).length === 6, 'finds missing from the queue');
        assert(ctx.name === 'Taste test · For you' && ctx.key === plId, JSON.stringify(ctx));
        const done2 = spy('playList');
        act('play-pl');
        const [l2, i2] = got;
        done2();
        assert(i2 === 0 && l2.map((t) => t.title).join() === shownTitles.join(), 'play button');
        const done3 = spy('playList');
        act('shuffle-pl');
        const [l3] = got;
        done3();
        assert(l3.length === shownTitles.length && new Set(l3.map((t) => t.title)).size === shownTitles.length, 'shuffle lost songs');
      });
      await test('for you', 'playing from Original still plays the original list', async () => {
        act('foryou-off');
        await sleep(300);
        const done = spy('playList');
        act('play-pl');
        const [list, , ctx] = got;
        done();
        assert(list.map((t) => t.title).join() === pl.tracks.map((t) => t.title).join() && !list.some((t) => t.find) && ctx.name === 'Taste test', 'Original changed');
      });
      await test('for you', 'what you finish and skip moves songs up and down the page', async () => {
        const first = pl.tracks[0], last = pl.tracks[13];
        localStorage.setItem('hum:taste', JSON.stringify(tasteOf([[last, { plays: 4, completes: 4 }], [first, { skips: 2, plays: 2 }]])));
        act('foryou-on');
        await until(() => tags().length === 6, 6000);
        const t = rowsOf();
        assert(t[0] === last.title, `top is ${t[0]}`);
        const own = t.filter((x) => pl.tracks.some((o) => o.title === x));
        assert(own.at(-1) === first.title, `skipped song is ${own.indexOf(first.title)} of ${own.length}`);
      });

      await test('for you', 'every station card has a For you link, and it opens that station', async () => {
        await home();
        const chips = $$('.station-fy');
        assert(chips.length === 8 && chips.every((c, i) => c.getAttribute('href') === `#/station/${i}?for-you`), 'chips');
        chips[0].click();
        await until(() => location.hash === '#/station/0?for-you', 3000);
        await until(() => $('#view .pl-hero h2')?.textContent === 'Midnight Drive', 3000);
      });
      await test('for you', 'a station page has the switch, with For you listing songs and finds', async () => {
        await go('#/station/0', 900);
        assert($('#view .pl-hero h2').textContent === 'Midnight Drive' && $('#view .eyebrow').textContent === 'Station', 'hero');
        assert($('#view .seg button.on').textContent.trim() === 'Original' && !$$('#view .row').length, 'Original should be just the hero');
        act('foryou-on');
        await until(() => tags().length === 3 && $$('#view .row[data-play]').length > 20, 8000);
        assert($('#view .fy-note') && JSON.parse(localStorage.getItem('hum:variants'))['Blinding Lights The Weeknd'].finds.length === 3, 'state not under the seed');
        const own = $$('#view .row[data-play]').length - 3;
        assert(own === 31, `station songs ${own}`);
      });
      await test('for you', 'a station plays the tuned list in For you and tunes in as usual in Original', async () => {
        const titles = rowsOf();
        const done = spy('playList');
        act('play-pl');
        const [list, , ctx] = got;
        done();
        assert(list.map((t) => t.title).join() === titles.join() && ctx.name === 'Midnight Drive · For you' && ctx.key === 'Blinding Lights The Weeknd', 'For you station');
        act('foryou-off');
        await sleep(300);
        const done2 = spy('station');
        act('play-pl');
        const [seed, name] = got;
        done2();
        assert(seed === 'Blinding Lights The Weeknd' && name === 'Midnight Drive', `${seed} ${name}`);
        document.querySelectorAll('.toast').forEach((x) => x.remove());
      });

      // ---- home ----
      const fakes = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ id: `sp-playlist-h${k}`, name: `Home ${k}`, source: 'spotify', tracks: mkList(`h${k}`, 6) }));
      H.lib.playlists = [...fakes, ...saved.playlists];
      const plays = (n) => tasteOf(mkList('hp', n).map((t) => [t, { plays: 1, completes: 1 }]));
      await test('for you', 'home has no Made for you row until there is something to learn from', async () => {
        resetTaste();
        await home();
        assert(!$('#view .fy-row') && !/Made for you/.test($('#view').textContent), 'row without signal');
        localStorage.setItem('hum:taste', JSON.stringify(plays(4)));
        await home();
        assert(!$('#view .fy-row'), 'row with four plays');
      });
      await test('for you', 'home shows up to 4 made for you, the most used playlists and stations first', async () => {
        const t = plays(6);
        const now = T.clock.now().getTime();
        t.uses = { 'sp-playlist-hc': { n: 9, last: now, name: 'Home c' }, 'Blinding Lights The Weeknd': { n: 5, last: now, name: 'Midnight Drive' }, 'sp-playlist-ha': { n: 2, last: now, name: 'Home a' }, 'gone-playlist': { n: 30, last: now, name: 'Deleted' } };
        localStorage.setItem('hum:taste', JSON.stringify(t));
        await home();
        const cards = $$('#view .fy-row .fy-card');
        assert(cards.length === 4, `cards ${cards.length}`);
        assert(cards.map((c) => c.querySelector('b').textContent).join() === 'Home c,Midnight Drive,Home a,Home b', cards.map((c) => c.querySelector('b').textContent).join());
        assert(cards.every((c) => /\?for-you$/.test(c.getAttribute('href'))), 'links do not open For you');
        assert($('#view .fy-row .fy-badge') && $$('#view .shelf-head h3').some((h) => h.textContent === 'Made for you'), 'badge or heading');
        assert(cards[1].getAttribute('href') === '#/station/0?for-you', cards[1].getAttribute('href'));
        cards[0].click();
        await until(() => location.hash === '#/pl/sp-playlist-hc?for-you', 3000);
        await until(() => $('#view .seg button.on')?.textContent.trim() === 'For you', 3000);
      });
    } finally {
      restoreApi();
    }
  } finally {
    T.clock.now = saved.clock;
    H.lib.playlists = saved.playlists;
    H.store.set('playlists', saved.playlists);
    for (const k of ['taste', 'variants']) saved[k] == null ? localStorage.removeItem(`hum:${k}`) : localStorage.setItem(`hum:${k}`, saved[k]);
    await go('#/', 400);
  }

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
