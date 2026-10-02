// The only bridge the notch page gets into the desktop app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humDesktop', {
  interactive: (on) => ipcRenderer.send('notch:interactive', !!on),
  showMain: () => ipcRenderer.send('main:show'),
});
