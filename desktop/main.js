// hum desktop: the player in its own window, plus a live island that sits over
// the MacBook notch. Without a notch (Windows, external screens) it floats at the
// top centre of the screen instead.
const { app, BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('node:path');

const HUM_URL = (process.env.HUM_URL || 'https://hum.anzalabidi.dev').replace(/\/$/, '');
const ISLAND = { width: 460, height: 300 };
let main;
let notch;

// A notched MacBook has a taller menu bar (about 37pt instead of 24pt) on its built-in screen.
function geometry() {
  const d = screen.getPrimaryDisplay();
  const menu = d.workArea.y - d.bounds.y;
  const hasNotch = process.platform === 'darwin' && d.internal && menu >= 32;
  return {
    bounds: { x: Math.round(d.bounds.x + d.bounds.width / 2 - ISLAND.width / 2), y: d.bounds.y, ...ISLAND },
    query: `notch=${hasNotch ? 1 : 0}&menu=${Math.max(menu, 24)}&width=${hasNotch ? 200 : 0}`,
    hasNotch,
  };
}

function createMain() {
  main = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#07060a',
    title: 'hum',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // keep the lyrics clock running while the window is in the background
    webPreferences: { backgroundThrottling: false },
  });
  // Debug runs are always silent.
  if (process.env.HUM_DEBUG) main.webContents.setAudioMuted(true);
  main.loadURL(HUM_URL);
  main.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  main.on('closed', () => {
    main = null;
    app.quit();
  });
}

function createNotch() {
  const g = geometry();
  notch = new BrowserWindow({
    ...g.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    enableLargerThanScreen: true,
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // Above the menu bar, on every desktop, even over full-screen apps.
  notch.setAlwaysOnTop(true, 'screen-saver');
  notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks pass straight through the transparent area until the island is hovered.
  notch.setIgnoreMouseEvents(true, { forward: true });
  notch.loadURL(`${HUM_URL}/notch.html?${g.query}`);
  notch.once('ready-to-show', () => {
    notch.setBounds(g.bounds);
    notch.showInactive();
    if (process.env.HUM_DEBUG) debugSnapshots(g);
  });
}

// HUM_DEBUG=1 writes pictures of the island (closed and open) for checking without screenshots.
async function debugSnapshots(g) {
  const fs = require('node:fs');
  const out = process.env.HUM_DEBUG_DIR || require('node:os').tmpdir();
  console.log('notch', JSON.stringify({ wanted: g.bounds, got: notch.getBounds(), hasNotch: g.hasNotch }));
  await new Promise((r) => setTimeout(r, 6000));
  await notch.webContents.executeJavaScript(`document.querySelector('#n').classList.remove('open')`);
  await new Promise((r) => setTimeout(r, 900));
  const read = () => notch.webContents.executeJavaScript(`JSON.stringify({ idle: document.body.classList.contains('idle'), title: document.querySelector('.title').textContent, line: document.querySelector('.line').textContent, size: [document.querySelector('#n').offsetWidth, document.querySelector('#n').offsetHeight] })`);
  const mainState = () => main.webContents.executeJavaScript(`JSON.stringify({ playing: __hum.engine.playing, title: __hum.engine.current?.title || null, ctx: __hum.engine.ctx?.name, stored: !!localStorage.getItem('hum:session') })`);
  console.log('main', await mainState());
  console.log('closed', await read());
  fs.writeFileSync(path.join(out, 'notch-closed.png'), (await notch.webContents.capturePage()).toPNG());
  await notch.webContents.executeJavaScript(`document.querySelector('#n').classList.add('open')`);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('open', await read());
  fs.writeFileSync(path.join(out, 'notch-open.png'), (await notch.webContents.capturePage()).toPNG());
  await notch.webContents.executeJavaScript(`document.querySelector('#n').classList.remove('open')`);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon?.(path.join(__dirname, '..', 'public', 'icon-512.png'));
  createMain();
  createNotch();
  ipcMain.on('notch:interactive', (_, on) => notch?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('main:show', () => {
    if (!main) return createMain();
    main.show();
    main.focus();
  });
  screen.on('display-metrics-changed', () => notch?.setBounds(geometry().bounds));
});

app.on('window-all-closed', () => app.quit());
