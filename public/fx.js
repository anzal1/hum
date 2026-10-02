// Feel: card tilt with a moving sheen, a rich preview when you rest on a song,
// and shimmering placeholders until every picture has arrived.
import { sized, fmt } from './engine.js';
import { palette } from './palette.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const still = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- images fade in over a shimmer ----------

export function initImages() {
  const done = (img) => img.complete && img.naturalWidth > 0 && img.classList.add('ok');
  document.addEventListener('load', (e) => e.target.tagName === 'IMG' && e.target.classList.add('ok'), true);
  new MutationObserver((list) => {
    for (const m of list)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'IMG') done(n);
        else n.querySelectorAll?.('img').forEach(done);
      }
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('img').forEach(done);
}

// ---------- tilt and sheen ----------

const TILT = '.station, .tile, .pl-card, .top-card';
export function initTilt(root) {
  let el = null, frame = 0, ev = null;
  const paint = () => {
    frame = 0;
    if (!el || !ev) return;
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const max = el.classList.contains('top-card') ? 4 : 9;
    el.style.setProperty('--rx', `${((0.5 - y) * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * max).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };
  const leave = () => {
    if (!el) return;
    el.classList.remove('tilting');
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
    el = null;
  };
  root.addEventListener('pointermove', (e) => {
    if (!fine.matches || still.matches) return;
    const next = e.target.closest(TILT);
    if (next !== el) {
      leave();
      el = next;
      el?.classList.add('tilting');
    }
    ev = e;
    if (el && !frame) frame = requestAnimationFrame(paint);
  });
  root.addEventListener('pointerleave', leave);
  addEventListener('scroll', leave, { passive: true });
}

// ---------- song preview on hover ----------

export function initPeek(root, getTrack) {
  const card = document.createElement('div');
  card.id = 'peek';
  card.setAttribute('aria-hidden', 'true');
  document.body.append(card);
  let timer, row = null, x = 0, y = 0;

  const hide = () => {
    clearTimeout(timer);
    row = null;
    card.classList.remove('on');
  };
  const place = () => {
    const w = card.offsetWidth || 300, h = card.offsetHeight || 380;
    let left = x + 28, top = y - h / 2;
    if (left + w > innerWidth - 16) left = x - w - 28;
    top = Math.max(16, Math.min(innerHeight - h - 16, top));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  const show = (t) => {
    const art = t.art ? sized(t.art, 600) : t.id ? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg` : '';
    const fb = t.id ? ` data-fb="https://i.ytimg.com/vi/${t.id}/hqdefault.jpg"` : '';
    card.innerHTML = `
      <div class="peek-art">${art ? `<img class="peek-glow" src="${esc(art)}"${fb} alt=""><span class="peek-frame"><img class="peek-img" src="${esc(art)}"${fb} alt=""></span>` : ''}</div>
      <div class="peek-text">
        <b>${esc(t.title)}</b>
        <span>${esc(t.artist)}</span>
        <i>${[t.album && t.album !== t.title ? esc(t.album) : '', t.duration ? fmt(t.duration) : ''].filter(Boolean).join(' · ')}</i>
      </div>
      <div class="peek-hint"><kbd>Click</kbd> play <kbd>+</kbd> play next</div>`;
    place();
    card.classList.add('on');
    if (t.art)
      palette(sized(t.art, 120)).then((p) => p && row && card.style.setProperty('--pc', p.accent.join(' ')));
  };

  root.addEventListener('pointerover', (e) => {
    if (!fine.matches) return;
    const next = e.target.closest('.row[data-play]');
    if (next === row) return;
    hide();
    if (!next || next.closest('.skeleton')) return;
    row = next;
    timer = setTimeout(() => {
      const t = row && getTrack(row);
      if (t) show(t);
    }, 380);
  });
  root.addEventListener('pointermove', (e) => {
    x = e.clientX;
    y = e.clientY;
    if (card.classList.contains('on')) place();
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('click', hide);
  addEventListener('scroll', hide, { passive: true });
  addEventListener('keydown', hide);
  return { hide };
}
