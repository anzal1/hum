// The Sync panel and the timers that keep it going. All the logic lives in sync.js;
// this file only draws the sheet, wires focus and timers, and offers the manual backup.
import { createSync, KEYS, SyncError } from './sync.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (d) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  cloud: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  down: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  up: svg('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>'),
};

function ago(t) {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function initSync({ store, toast = () => {}, onMerged = () => {} }) {
  const raw = () => KEYS.map((k) => { try { return localStorage.getItem(`hum:${k}`) || ''; } catch { return ''; } }).join('\u0001');
  const sync = createSync({
    store,
    snapshot: raw,
    onChange: (keys) => {
      onMerged(keys);
      dispatchEvent(new CustomEvent('hum:synced', { detail: { keys } }));
    },
  });
  (window.__hum ||= {}).sync = sync;

  let available = null; // null until the server answers, then true or false
  let reveal = false; // show the code in the sheet
  let joining = false;
  let msg = '';
  let msgKind = '';
  let opener = null;

  // ---------- the entry in the library shelf ----------

  const label = () => {
    const i = sync.info;
    if (!i.on) return available === false ? 'Backup' : 'Sync';
    if (i.phase === 'error' || i.phase === 'offline') return 'Sync paused';
    return i.phase === 'syncing' ? 'Syncing' : 'Synced';
  };
  const chip = () => `<button class="pill small sync-chip ${sync.info.on ? 'on' : ''}" data-sync="open" aria-haspopup="dialog">${ICONS.cloud}<span>${label()}</span></button>`;
  function paintSlots() {
    document.querySelectorAll('[data-sync-slot]').forEach((slot) => {
      if (available === null && !sync.info.on) return;
      const html = chip();
      if (slot.dataset.html !== html) ((slot.dataset.html = html), (slot.innerHTML = html)); // no change, no mutation, no loop
    });
  }
  const view = $('#view');
  if (view) new MutationObserver(paintSlots).observe(view, { childList: true, subtree: true });

  // ---------- the sheet ----------

  const back = document.createElement('div');
  back.className = 'sync-back';
  back.hidden = true;
  back.innerHTML = `<div class="sync-sheet" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sync-title"><button class="icon-btn small sync-x" data-sync="close" aria-label="Close">${ICONS.x}</button><div class="sync-body"></div></div>`;
  document.body.append(back);
  const bodyEl = $('.sync-body', back);
  const input = () => $('#sync-code-in', back);

  const note = (text, kind = '') => {
    msg = text;
    msgKind = kind;
    const el = $('.sync-msg', back);
    if (el) ((el.textContent = text), (el.className = `sync-msg ${kind}`));
  };

  function syncPart() {
    const i = sync.info;
    if (!i.on) {
      if (available === false) return '';
      return `
        <h2 id="sync-title">Keep your library with you</h2>
        <p class="sync-lede">Your likes, playlists and history, on every device you use. No account, no email. Everything is locked in your browser with a code that only you hold, so the server stores scrambled bytes it cannot read.</p>
        ${
          joining
            ? `<form class="sync-join" autocomplete="off"><input id="sync-code-in" class="sync-input" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" spellcheck="false" autocapitalize="characters" aria-label="Sync code"><div class="sync-row"><button class="pill" type="submit" data-sync="connect">Connect</button><button class="pill ghost" type="button" data-sync="cancel">Cancel</button></div></form>`
            : `<div class="sync-row"><button class="pill primary" data-sync="enable">Turn on sync</button><button class="pill" data-sync="join">Use a sync code</button></div>`
        }`;
    }
    const status = i.phase === 'syncing' ? 'Syncing now' : i.phase === 'error' || i.phase === 'offline' ? esc(i.error) : `Last synced ${ago(i.lastSynced)}`;
    return `
      <h2 id="sync-title">Sync is on</h2>
      <p class="sync-lede">Enter this code on another device, or on the local hum, and it shows the same library. Keep it somewhere safe. Anyone with the code can read and change your library, and nobody can recover it for you.</p>
      <div class="sync-codebox"><code class="sync-code ${reveal ? '' : 'hide'}" aria-label="Your sync code">${reveal ? esc(i.code) : '••••-••••-••••-••••-••••-••••-••••'}</code></div>
      <div class="sync-row"><button class="pill" data-sync="reveal">${reveal ? 'Hide code' : 'Show code'}</button><button class="pill" data-sync="copy">${ICONS.copy} Copy</button></div>
      <p class="sync-status ${i.phase === 'error' || i.phase === 'offline' ? 'bad' : ''}">${status}</p>
      <div class="sync-row"><button class="pill" data-sync="now">Sync now</button><button class="pill ghost" data-sync="off">Turn off sync</button></div>
      <p class="sync-fine">Turning sync off stops it on this device and keeps your library here.</p>`;
  }

  function render() {
    const had = document.activeElement?.dataset?.sync;
    bodyEl.innerHTML = `
      ${syncPart()}
      <div class="sync-backup ${available === false && !sync.info.on ? 'solo' : ''}">
        ${available === false && !sync.info.on ? '<h2 id="sync-title">Back up your library</h2>' : '<h3>Backup</h3>'}
        <p class="sync-fine">A JSON file of your likes, playlists and history. Importing adds it to what you have, nothing is replaced.</p>
        <div class="sync-row"><button class="pill" data-sync="export">${ICONS.down} Export library</button><button class="pill" data-sync="import">${ICONS.up} Import</button><input id="sync-file" type="file" accept="application/json,.json" hidden></div>
      </div>
      <p class="sync-msg ${msgKind}" role="status" aria-live="polite">${esc(msg)}</p>`;
    if (joining) input()?.focus();
    else if (!back.hidden && document.activeElement === document.body) $('.sync-sheet', back).focus();
    else if (had) $(`[data-sync="${had}"]`, bodyEl)?.focus();
  }

  function openSheet() {
    opener = document.activeElement;
    msg = '';
    msgKind = '';
    joining = false;
    render();
    back.hidden = false;
    requestAnimationFrame(() => back.classList.add('in'));
    ($('button:not(.sync-x)', bodyEl) || $('.sync-x', back)).focus();
    clearInterval(openSheet.t);
    openSheet.t = setInterval(() => !back.hidden && !joining && sync.info.on && render(), 30000);
  }
  function closeSheet() {
    back.classList.remove('in');
    reveal = false;
    clearInterval(openSheet.t);
    setTimeout(() => (back.hidden = true), 220);
    opener?.focus?.();
  }

  const fail = (e) => note(e instanceof SyncError ? e.message : 'Something went wrong. Try again.', 'bad');

  const actions = {
    open: openSheet,
    close: closeSheet,
    async enable() {
      note('');
      reveal = true;
      await sync.enable();
      render();
      note('Sync is on. Copy your code now, then enter it on your other devices.', 'good');
    },
    join() {
      joining = true;
      note('');
      render();
    },
    cancel() {
      joining = false;
      note('');
      render();
    },
    async connect() {
      const code = input()?.value || '';
      note('Looking for your library…');
      try {
        await sync.join(code);
        joining = false;
        render();
        note('Connected. Your library is syncing.', 'good');
      } catch (e) {
        fail(e);
      }
    },
    reveal() {
      reveal = !reveal;
      render();
    },
    async copy() {
      try {
        await navigator.clipboard.writeText(sync.info.code);
        note('Code copied.', 'good');
      } catch {
        reveal = true;
        render();
        note('Could not copy. Select the code and copy it by hand.', 'bad');
      }
    },
    async now() {
      note('');
      await sync.now();
      render();
    },
    off() {
      if (!confirm('Turn off sync on this device? Your library stays here. You will need your code to turn it on again.')) return;
      sync.disable();
      reveal = false;
      msg = '';
      render();
      note('Sync is off. Your library is still on this device.', 'good');
    },
    export() {
      const data = sync.exportLibrary();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `hum-library-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      note(`Exported ${data.liked?.length || 0} liked songs and ${data.playlists?.length || 0} playlists.`, 'good');
    },
    import() {
      $('#sync-file', back).click();
    },
  };

  back.addEventListener('click', (e) => {
    if (e.target === back) return closeSheet();
    const el = e.target.closest('[data-sync]');
    if (!el) return;
    e.preventDefault();
    actions[el.dataset.sync]?.();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-sync="open"]');
    if (el && !back.contains(el)) (e.preventDefault(), openSheet());
  });
  back.addEventListener('submit', (e) => (e.preventDefault(), actions.connect()));
  back.addEventListener('change', async (e) => {
    if (e.target.id !== 'sync-file') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5e6) throw new SyncError('file', 'That file is too big to be a hum backup.');
      const r = sync.importLibrary(JSON.parse(await file.text()));
      note(`Imported ${r.liked} liked songs and ${r.playlists} playlists.`, 'good');
    } catch (err) {
      note(err instanceof SyncError ? err.message : 'That file could not be read as a hum backup.', 'bad');
    }
  });
  // Keys typed in the sheet must not reach the player shortcuts.
  back.addEventListener('keydown', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !back.hidden && closeSheet(), true);

  // ---------- keeping it going ----------

  sync.subscribe(() => {
    paintSlots();
    if (!back.hidden && document.activeElement?.id !== 'sync-code-in') render();
  });

  if (sync.on) sync.pull();
  sync.probe().then((ok) => {
    available = ok;
    paintSlots();
  });
  setInterval(() => sync.check(), 5000);
  setInterval(() => document.visibilityState === 'visible' && sync.pull(), 60000);
  const wake = () => document.visibilityState === 'visible' && sync.pull();
  addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);

  return sync;
}
