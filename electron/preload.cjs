// Bridge between the page and the app: the actions on the computer that the browser cannot do in the foreground.
const { contextBridge, ipcRenderer } = require('electron');

// Remote mode (main.cjs: the window shows a dashboard running on a server): the paths are those of the server, so
// the actions on this computer (default app, folder picker) are not offered: the page falls back to typing a path or
// to its server routes (refused by a server), and hides the buttons in server mode.
const REMOTE = process.argv.includes('--dash-remote');

contextBridge.exposeInMainWorld('desktop', {
  remote: REMOTE,
  openExternal: url => ipcRenderer.invoke('open-external', url),
  // After a native dialog (alert, confirm) on Windows, the page no longer gets the keyboard: the window takes the focus again
  restoreFocus: () => ipcRenderer.invoke('restore-focus'),
  // Kept in remote mode (called without a check by the page), but main.cjs then does nothing
  showInExplorer: path => ipcRenderer.invoke('show-in-explorer', path),
  ...(REMOTE ? {} : {
    openWithDefault: path => ipcRenderer.invoke('open-with-default', path),
    // Native folder picker (adding a project): returns the chosen path or null
    chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  }),
});
