/*!
 * hum embed. Drop one script tag into any page:
 *
 *   <script src="https://YOUR-HUM-HOST/embed.js" data-station="lofi"></script>
 *
 * Options (all optional, as data- attributes):
 *   data-station   start a mood, e.g. "lofi beats" or "Kesariya"
 *   data-q         start a specific song
 *   data-playlist  start a public Spotify playlist link
 *   data-target    CSS selector to mount into instead of floating in a corner
 *   data-position  bottom-right (default), bottom-left, top-right, top-left
 *   data-open      "false" to start collapsed into a small button
 *
 * Then control it from your code:
 *   hum.play('Blinding Lights')   hum.station('deep focus')   hum.playlist(url)
 *   hum.pause()  hum.resume()  hum.next()  hum.prev()  hum.volume(60)
 *   hum.state().then(s => ...)    hum.on('state', s => ...)
 *   hum.open()   hum.close()      hum.toggle()
 */
(() => {
  if (window.hum?.__ready) return;
  const script = document.currentScript;
  const base = new URL('.', script?.src || location.href).href;
  const opts = script?.dataset || {};
  const params = new URLSearchParams();
  ['station', 'q', 'playlist', 'accent'].forEach((k) => opts[k] && params.set(k, opts[k]));

  const listeners = {};
  const waiting = new Map();
  let ready;
  const readyP = new Promise((r) => (ready = r));
  let seq = 0;

  const iframe = document.createElement('iframe');
  if (!opts.target) params.set('hideable', '1');
  iframe.src = `${base}widget.html?${params}`;
  iframe.title = 'hum music player';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; clipboard-write';
  iframe.loading = 'eager';

  const pos = (opts.position || 'bottom-right').split('-');
  const target = opts.target && document.querySelector(opts.target);
  const wrap = document.createElement('div');
  wrap.setAttribute('data-hum', '');
  const shadow = wrap.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; ${pos[0]}: 16px; ${pos[1]}: 16px; z-index: 2147483000; width: 360px; height: 520px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
        border-radius: 22px; overflow: hidden; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); background: #08070b;
        transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .3s; transform-origin: ${pos[1]} ${pos[0]}; }
      .box.inline { position: relative; inset: auto; width: 100%; height: 100%; max-width: none; max-height: none; box-shadow: none; }
      .box.closed { transform: scale(.6); opacity: 0; pointer-events: none; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
      .fab { position: fixed; ${pos[0]}: 16px; ${pos[1]}: 16px; z-index: 2147483000; width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
        background: radial-gradient(circle at 30% 25%, #ffb38a, #9b3fd6 55%, #140c22); color: #fff; font: italic 22px Georgia, serif;
        box-shadow: 0 16px 40px -10px rgba(155,63,214,.7); transition: transform .3s cubic-bezier(.34,1.4,.5,1); }
      .fab:hover { transform: scale(1.08); }
      .fab[hidden] { display: none; }
    </style>
    <div class="box ${target ? 'inline' : ''}"></div>
    <button class="fab" aria-label="Open hum" hidden>h</button>`;
  const box = shadow.querySelector('.box');
  const fab = shadow.querySelector('.fab');
  box.prepend(iframe);
  (target || document.body).append(wrap);

  // A hidden YouTube player is not allowed to keep playing, so hiding pauses.
  const close = () => {
    send('pause');
    box.classList.add('closed');
    fab.hidden = false;
  };
  const open = () => {
    box.classList.remove('closed');
    fab.hidden = true;
  };
  fab.onclick = open;
  if (!target && opts.open === 'false') close();

  addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow || !e.data?.hum) return;
    const { hum: kind, id, ...rest } = e.data;
    if (kind === 'ready') ready();
    if (kind === 'hide') close();
    if (kind === 'reply' && waiting.has(id)) {
      waiting.get(id)(rest);
      waiting.delete(id);
    }
    if (kind === 'state') (listeners.state || []).forEach((fn) => fn(rest));
  });

  function send(cmd, args = {}) {
    return readyP.then(
      () =>
        new Promise((resolve) => {
          const id = ++seq;
          waiting.set(id, resolve);
          iframe.contentWindow.postMessage({ hum: cmd, id, ...args }, '*');
          setTimeout(() => waiting.has(id) && (waiting.delete(id), resolve({ ok: false, text: 'timeout' })), 20000);
        }),
    );
  }

  window.hum = {
    __ready: true,
    play: (query) => (open(), send('play', query ? { query } : {})),
    station: (mood) => (open(), send('station', { mood })),
    playlist: (url) => (open(), send('playlist', { url })),
    pause: () => send('pause'),
    resume: () => (open(), send('resume')),
    next: () => send('next'),
    prev: () => send('prev'),
    volume: (value) => send('volume', { value }),
    seek: (seconds) => send('seek', { seconds }),
    state: () => send('snapshot').then((r) => r.state),
    on: (event, fn) => ((listeners[event] ||= []).push(fn), () => (listeners[event] = listeners[event].filter((f) => f !== fn))),
    open,
    close,
    toggle: () => (box.classList.contains('closed') ? open() : close()),
    element: wrap,
  };
})();
