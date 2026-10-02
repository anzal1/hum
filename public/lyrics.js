// Time-synced lyrics from LRCLIB, an open lyrics database that needs no key.
const LRCLIB = 'https://lrclib.net/api/';

const cleanTitle = (s) =>
  s
    .replace(/\s*[([](from|feat\.?|ft\.?|with|official|lyrics?|audio|video|visuali[sz]er|remaster(ed)?|explicit|prod\.?)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(official|lyrics?|audio|from|remaster).*$/i, '')
    .trim();
const mainArtist = (s) => s.split(/,|&| x | feat\.?| ft\.?| and /i)[0].trim();

function parse(lrc) {
  const lines = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

export async function fetchLyrics(track) {
  const title = cleanTitle(track.title);
  const artist = mainArtist(track.artist || '');
  const get = async (path) => {
    const r = await fetch(LRCLIB + path);
    return r.ok ? r.json() : null;
  };
  const pick = (d) => (d?.syncedLyrics ? { synced: parse(d.syncedLyrics) } : d?.plainLyrics ? { plain: d.plainLyrics } : null);
  // A song titled in Latin script usually wants romanised lyrics, not Devanagari or Gurmukhi.
  const latin = (s) => (s.match(/[A-Za-z]/g) || []).length > (s.replace(/\s/g, '').length || 1) * 0.6;
  const fits = (d) => !latin(track.title) || latin((d.syncedLyrics || d.plainLyrics || '').slice(0, 400).replace(/\[[^\]]*\]/g, ''));
  try {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.duration) qs.set('duration', Math.round(track.duration));
    const exact = await get(`get?${qs}`);
    if (pick(exact) && fits(exact)) return pick(exact);
    const list = (await get(`search?${new URLSearchParams({ track_name: title, artist_name: artist })}`)) || [];
    const near = (d) => !track.duration || Math.abs((d.duration || 0) - track.duration) < 6;
    return pick(
      list.find((d) => d.syncedLyrics && near(d) && fits(d)) ||
        list.find((d) => d.syncedLyrics && fits(d)) ||
        (pick(exact) ? exact : null) ||
        list.find((d) => d.syncedLyrics && near(d)) ||
        list.find((d) => d.syncedLyrics) ||
        list.find((d) => d.plainLyrics),
    );
  } catch {
    return null;
  }
}

export class LyricsView {
  constructor(el, { onSeek, onLine }) {
    this.el = el;
    this.onSeek = onSeek;
    this.onLine = onLine;
    this.lines = [];
    this.active = -1;
    this.userScroll = 0;
    const markUser = () => (this.userScroll = performance.now());
    el.addEventListener('wheel', markUser, { passive: true });
    el.addEventListener('touchmove', markUser, { passive: true });
    el.addEventListener('click', (e) => {
      const line = e.target.closest('[data-t]');
      if (line) {
        this.userScroll = 0;
        this.onSeek(Number(line.dataset.t));
      }
    });
  }
  state(kind, message) {
    this.lines = [];
    this.active = -1;
    this.el.dataset.mode = kind;
    this.el.innerHTML = `<div class="lyrics-note">${message}</div>`;
  }
  set(data) {
    this.active = -1;
    if (data?.synced?.length) {
      this.lines = data.synced;
      this.el.dataset.mode = 'synced';
      this.el.innerHTML =
        '<div class="lyrics-pad"></div>' +
        this.lines.map((l, i) => `<p data-i="${i}" data-t="${l.t}">${l.text ? escapeHtml(l.text) : '<span class="dots"><i></i><i></i><i></i></span>'}</p>`).join('') +
        '<div class="lyrics-pad"></div>';
      this.nodes = [...this.el.querySelectorAll('p')];
      this.el.scrollTop = 0;
    } else if (data?.plain) {
      this.lines = [];
      this.el.dataset.mode = 'plain';
      this.el.innerHTML = `<div class="lyrics-plain">${escapeHtml(data.plain).replace(/\n/g, '<br>')}</div><div class="lyrics-note small">These lyrics are not time-synced.</div>`;
      this.el.scrollTop = 0;
    } else {
      this.state('none', 'No lyrics for this one.<br><em>Just vibe.</em>');
    }
  }
  update(time) {
    if (!this.lines.length) return;
    let i = -1;
    for (let k = 0; k < this.lines.length; k++) {
      if (this.lines[k].t <= time + 0.15) i = k;
      else break;
    }
    if (i === this.active) return;
    this.active = i;
    this.nodes.forEach((n, k) => {
      const d = Math.min(Math.abs(k - i), 5);
      n.classList.toggle('on', k === i);
      n.classList.toggle('past', k < i);
      n.style.setProperty('--d', i < 0 ? 2 : d);
    });
    if (i >= 0) this.onLine?.(this.lines[i]);
    this.follow();
  }
  follow(instant) {
    if (this.active < 0 || performance.now() - this.userScroll < 3500) return;
    const n = this.nodes[this.active];
    this.el.scrollTo({ top: n.offsetTop - this.el.clientHeight * 0.32, behavior: instant ? 'auto' : 'smooth' });
  }
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
