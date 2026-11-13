// Electron app of the dashboard: a window on the page (http://localhost:4747), an icon in the notification area
// with the sessions that are waiting, and the actions on the computer (explorer, browser).
// It holds no session: the page and the engine run as detached processes, which it starts if they are not
// running. Quitting the app therefore stops nothing.
// Remote mode ("Connect to a server…" in the tray menu): the window shows a dashboard running on a server (Docker,
// docs/server.md) instead; nothing is started locally and the polling goes through the Electron session, so the
// login cookie of the server is sent.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, ipcMain, screen, dialog, session } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadI18n, applyLanguage, DASH_DIR } = require('./language.cjs');

const PORT = Number(process.env.DASH_PORT || 4747);
// Launched by Windows at session login: icon only, window hidden until the first click
const STARTUP_ARGS = ['--at-startup'];
const AT_STARTUP = process.argv.includes(STARTUP_ARGS[0]) || process.argv.includes('--au-demarrage'); // --au-demarrage: its former French name, still in older startup entries
const LOCAL_BASE = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const fs = require('node:fs');

// Texts: t() of public/i18n, loaded at startup (whenReady) before anything is shown
let t = key => key;

let win = null, tray = null, quitting = false;
let waitingBefore = null; // slugs already waiting for an answer at the last poll (null: first poll, no notification)

// --- Remote mode: the dashboard of a server ------------------------------------------------------

// State of the app kept between launches: { server, lastServer }; `server` set = remote mode
const APP_FILE = path.join(DASH_DIR, 'app.json');
function readAppState() {
  try { return JSON.parse(fs.readFileSync(APP_FILE, 'utf8')); } catch { return {}; }
}
function writeAppState(state) {
  fs.mkdirSync(path.dirname(APP_FILE), { recursive: true });
  fs.writeFileSync(APP_FILE, JSON.stringify(state, null, 2));
}
/** Server address cleaned up (origin + path without the trailing slash), or null if it is not an http(s) URL. */
function cleanServerUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}
let serverUrl = cleanServerUrl(readAppState().server);
const remote = () => !!serverUrl;
/** Address of the dashboard shown and polled: the server in remote mode, the local page otherwise. */
const base = () => serverUrl || LOCAL_BASE;
/** Request to the dashboard. Remote mode: through the Electron session, with its cookies (login on the server). */
function api(route, options = {}) {
  if (!remote()) return fetch(`${LOCAL_BASE}${route}`, options);
  return session.defaultSession.fetch(`${serverUrl}${route}`, { ...options, credentials: 'include' });
}

/** Small window asking for the server address. Resolves with the cleaned URL, or null if cancelled. */
function askServerUrl() {
  return new Promise(resolve => {
    const modal = !!win?.isVisible();
    const prompt = new BrowserWindow({
      width: 480, height: 230, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: t('electron.connect.title'), icon: APP_ICON, parent: modal ? win : undefined, modal,
      backgroundColor: '#0f1115', webPreferences: { contextIsolation: true, sandbox: true },
    });
    const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    // No preload: the page answers through its title ("connect:<url>" or "cancel"), read by page-title-updated
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(t('electron.connect.title'))}</title>
<style>body{font:14px system-ui,sans-serif;background:#0f1115;color:#e6e6e6;margin:18px}
input{width:100%;box-sizing:border-box;padding:7px;margin:8px 0;background:#1a1d24;color:inherit;border:1px solid #333;border-radius:4px}
p{min-height:1.2em;color:#f87171;margin:0}.b{text-align:right;margin-top:10px}button{padding:6px 14px;margin-left:6px}</style>
<form id="f"><label for="u">${esc(t('electron.connect.label'))}</label>
<input id="u" autofocus placeholder="https://dash.example.com" value="${esc(readAppState().lastServer || '')}">
<p id="e"></p><div class="b"><button type="button" id="c">${esc(t('electron.connect.cancel'))}</button>
<button type="submit">${esc(t('electron.connect.ok'))}</button></div></form>
<script>
const u = document.getElementById('u');
u.select();
document.getElementById('c').onclick = () => { document.title = 'cancel'; };
addEventListener('keydown', e => { if (e.key === 'Escape') document.title = 'cancel'; });
document.getElementById('f').onsubmit = e => {
  e.preventDefault();
  let ok = false;
  try { const x = new URL(u.value.trim()); ok = /^https?:$/.test(x.protocol) && !!x.hostname; } catch {}
  if (!ok) { document.getElementById('e').textContent = ${JSON.stringify(t('electron.connect.invalid'))}; return; }
  document.title = 'connect:' + u.value.trim();
};
</script>`;
    let answer = null;
    prompt.on('page-title-updated', (e, title) => {
      e.preventDefault();
      if (title === 'cancel') prompt.close();
      else if (title.startsWith('connect:')) { answer = cleanServerUrl(title.slice(8)); if (answer) prompt.close(); }
    });
    prompt.on('closed', () => resolve(answer));
    prompt.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

/** Switches the app to a server (url) or back to the local page (null): window created again, polling state reset. */
async function switchServer(url) {
  serverUrl = url;
  const state = readAppState();
  if (url) { state.server = url; state.lastServer = url; } else delete state.server;
  writeAppState(state);
  waitingBefore = null; devicesSeen = null; announcementSeen = null;
  tray.setToolTip(t('electron.tooltip.starting'));
  tray.setContextMenu(trayMenu(0));
  if (!url && !(await ensureServer())) tray.setToolTip(t('electron.tooltip.unreachable'));
  // The preload exposes the actions on this computer according to the mode: the window is created again
  if (win) {
    const visible = win.isVisible();
    win.destroy();
    win = null;
    createWindow();
    if (visible) show();
  }
  new Notification({ title: t('electron.appName'), body: url ? t('electron.notif.connectedBody', { url }) : t('electron.notif.localBody') }).show();
  poll();
}
async function connectToServer() {
  const url = await askServerUrl();
  if (url) await switchServer(url);
}

// --- Page and engine ---------------------------------------------------------------------------

async function pageAlive() {
  try { return (await fetch(`${LOCAL_BASE}/api/ping`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}
/** Starts the page (which starts the engine) with Electron's embedded Node, detached from the app. */
async function ensureServer() {
  if (await pageAlive()) return true;
  spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await pageAlive()) return true;
  }
  return false;
}
/** Restarts the page alone, without touching the engine or the sessions (like "node dash.mjs restart"). */
async function restartPage() {
  await fetch(`${LOCAL_BASE}/api/stop`, { method: 'POST' }).catch(() => {});
  for (let i = 0; i < 25 && (await pageAlive()); i++) await new Promise(r => setTimeout(r, 200));
  return ensureServer();
}

// --- Local network: the page also listens on the wifi (setting read by server.mjs at startup) ------------

const NETWORK_FILE = path.join(DASH_DIR, 'network.json');
function networkOpen() {
  try { return JSON.parse(fs.readFileSync(NETWORK_FILE, 'utf8')).lan === true; } catch { return false; }
}
/** Writes the setting and restarts the page alone (the sessions live in the engine, nothing is stopped). */
async function openNetwork(on) {
  fs.mkdirSync(path.dirname(NETWORK_FILE), { recursive: true });
  fs.writeFileSync(NETWORK_FILE, JSON.stringify({ lan: on }, null, 2));
  await restartPage();
  const { addresses = [] } = await fetch(`${LOCAL_BASE}/api/network`).then(r => r.json()).catch(() => ({}));
  new Notification({
    title: on ? t('electron.notif.wifiOnTitle') : t('electron.notif.wifiOffTitle'),
    body: on ? t('electron.notif.wifiOnBody', { addresses: addresses.join(', ') || t('electron.notif.noAddress') }) : t('electron.notif.wifiOffBody'),
  }).show();
  win?.reload();
}

// --- Update pushed from another PC (files copied over the network share) ----------------
// The PC that has the git repo copies the updated files here over the share, then writes .reload.json
// (private update script). We then restart the page, and the engine if engine files changed, like
// "node dash.mjs restart": connected browsers reconnect and reload the new code.
const RELOAD_FILE = path.join(ROOT, '.reload.json');
// The file can arrive with a BOM (written by PowerShell on the other PC): JSON.parse would reject it, so we strip it.
const readReload = () => { try { return JSON.parse(fs.readFileSync(RELOAD_FILE, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
let reloadTs = readReload()?.ts || '';

async function applyReload() {
  const order = readReload();
  if (!order || remote()) return; // remote mode: the local page is not used
  if (!order.ts || order.ts === reloadTs) return; // incomplete file, or already applied
  reloadTs = order.ts;
  // The engine stops the sessions: "deferred" restarts it as soon as everything is idle (its own turn included),
  // the sessions then resume paused with the new code. The page restarts without stopping anything.
  if (order.engine) await fetch(`${LOCAL_BASE}/api/engine/stop?deferred=1`, { method: 'POST' }).catch(() => {});
  await restartPage();
  win?.webContents.reload();
  new Notification({ title: t('electron.notif.updatedTitle'), body: order.engine ? t('electron.notif.updatedBoth') : t('electron.notif.updatedPage') }).show();
}

function watchReload() {
  let timer = null;
  try {
    fs.watch(ROOT, (_ev, name) => {
      if (name && name !== '.reload.json') return; // some systems do not give the name: we read it again anyway
      clearTimeout(timer);
      timer = setTimeout(applyReload, 400);
    });
  } catch { /* fs.watch unavailable: the update will apply at the next launch */ }
}

// --- Icons: the control tower (electron/icons, made by make-icons.cjs) ---------------

const ICONS = path.join(__dirname, 'icons');
const APP_ICON = path.join(ICONS, 'app.ico'); // window, taskbar, shortcuts
/** Notification area: in colour when a session is blocked or has news not seen yet, grey otherwise (16 px and 32 px for HiDPI screens). */
const trayIcons = {};
function trayIcon(alert) {
  const key = alert ? 'alert' : 'idle';
  if (!trayIcons[key]) {
    const img = nativeImage.createFromPath(path.join(ICONS, `notif-${key}-16.png`));
    img.addRepresentation({ scaleFactor: 2, buffer: require('node:fs').readFileSync(path.join(ICONS, `notif-${key}-32.png`)) });
    trayIcons[key] = img;
  }
  return trayIcons[key];
}
/**
 * Badge put on the taskbar icon, like a messaging badge: red when a session is blocked on a question, blue when a
 * session has news not seen yet. ("Waiting for your answer" no longer counts: almost always true, the badge never
 * went off.)
 */
const BADGE_COLOURS = { red: [220, 38, 38], blue: [37, 99, 235] };
const badges = {};
function badge(colour) {
  if (badges[colour]) return badges[colour];
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), i = (y * s + x) * 4;
    const a = Math.max(0, Math.min(1, 7.2 - d)), edge = d > 5.6 && d < 7.2; // light ring to set the badge apart
    const [r, g, b] = edge ? [255, 255, 255] : BADGE_COLOURS[colour];
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = Math.round(a * 255); // BGRA
  }
  return (badges[colour] = nativeImage.createFromBitmap(buf, { width: s, height: s }));
}

function trayMenu(n) {
  return Menu.buildFromTemplate([
    { label: n ? t('electron.tray.waiting', { n }) : t('electron.tray.noneWaiting'), enabled: false },
    { type: 'separator' },
    { label: t('electron.tray.open'), click: show },
    { label: t('electron.tray.openInBrowser'), click: () => shell.openExternal(base()) },
    { type: 'separator' },
    ...(remote() ? [
      { label: t('electron.tray.connectedTo', { url: serverUrl }), enabled: false },
      { label: t('electron.tray.connectOther'), click: connectToServer },
      { label: t('electron.tray.backToLocal'), click: () => switchServer(null) },
    ] : [
      { label: t('electron.tray.connect'), click: connectToServer },
      // The local network only concerns the local page
      { label: t('electron.tray.wifi'), type: 'checkbox', checked: networkOpen(),
        click: m => openNetwork(m.checked) },
    ]),
    { type: 'separator' },
    { label: t('electron.tray.startup'), type: 'checkbox', checked: app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin,
      click: m => {
        app.setLoginItemSettings({ openAtLogin: m.checked, args: STARTUP_ARGS });
        new Notification({ title: t('electron.appName'), body: m.checked ? t('electron.notif.startupOn') : t('electron.notif.startupOff') }).show();
      } },
    { label: t('electron.tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]);
}

/** Session poll: icon, tooltip, taskbar flashing and a notification for each new wait. */
async function poll() {
  applyLanguage(app); // the language can be changed from the page's Options
  let list = [];
  try {
    const r = await api('/api/sessions');
    if (!r.ok) throw new Error(`HTTP ${r.status}`); // remote mode: not logged in yet (401) or device not approved
    list = await r.json();
  } catch {
    if (remote()) {
      tray.setImage(trayIcon(false));
      tray.setToolTip(t('electron.tooltip.remoteUnreachable', { url: serverUrl }));
      tray.setContextMenu(trayMenu(0));
      win?.setOverlayIcon(null, '');
    }
    return;
  }
  const waiting = list.filter(s => s.status === 'waiting');
  const fresh = waitingBefore ? waiting.filter(s => !waitingBefore.has(s.slug)) : [];
  waitingBefore = new Set(waiting.map(s => s.slug));
  // The window title comes from the page (total of news not seen yet)
  const unread = list.reduce((n, s) => n + (s.unread || 0), 0), blocked = list.filter(s => s.blocked).length;
  const what = [blocked && t('electron.tooltip.blocked', { n: blocked }), unread && t('electron.tooltip.unread', { n: unread })].filter(Boolean).join(', ');
  tray.setImage(trayIcon(blocked || unread));
  tray.setToolTip(what ? t('electron.tooltip.summary', { what }) : t('electron.tooltip.nothing'));
  tray.setContextMenu(trayMenu(waiting.length));
  win?.setOverlayIcon(blocked ? badge('red') : unread ? badge('blue') : null, what);
  for (const s of fresh) {
    if (win?.isFocused()) continue; // already in sight
    const n = new Notification({ title: `${s.ticket ? `${s.ticket} · ` : ''}${s.title}`, body: s.statusSummary || t('electron.notif.waitingBody'), silent: false });
    n.on('click', () => { show(); win.loadURL(`${base()}/#${s.slug}`); });
    n.show();
    win?.flashFrame(true);
  }
  await pollDevices();
  await pollAchievements();
}

/** Achievements: Windows notification for a gold, platinum or legend milestone, and for a new rank (the rest: page toasts). */
let announcementSeen = null;
async function pollAchievements() {
  let r;
  try { r = await (await api(`/api/progress/announcements?since=${announcementSeen ?? 0}`)).json(); } catch { return; }
  if (announcementSeen === null) { announcementSeen = r.n; return; } // startup: only what comes next
  if (r.n < announcementSeen) { // engine restarted: its numbering starts again from zero, everything it announced is new
    announcementSeen = 0;
    try { r = await (await api('/api/progress/announcements?since=0')).json(); } catch { return; }
  }
  announcementSeen = r.n;
  for (const a of r.announcements || []) {
    const big = a.type === 'milestone' ? ['gold', 'platinum', 'legend'].includes(a.tier) : a.newRank;
    if (!big) continue;
    const title = a.type === 'milestone' ? t('electron.notif.achievementTitle', { name: a.name }) : t('electron.notif.levelTitle', { emoji: a.emoji, level: a.level, rank: a.rank });
    const n = new Notification({ title, body: a.type === 'milestone' ? `${a.desc || ''} · +${a.xp} XP` : t('electron.notif.newRank') });
    n.on('click', show);
    n.show();
  }
}

/** Device connected from the internet with the right password, waiting to be authorised: notification, even with the window in front. */
let devicesSeen = null;
async function pollDevices() {
  let access;
  try { access = await (await api('/api/access')).json(); } catch { return; }
  const pending = (access.devices || []).filter(a => !a.approved);
  const fresh = devicesSeen ? pending.filter(a => !devicesSeen.has(a.id)) : pending;
  devicesSeen = new Set(pending.map(a => a.id));
  for (const a of fresh) {
    const n = new Notification({ title: t('electron.notif.newDeviceTitle'), body: t('electron.notif.newDeviceBody', { name: a.name, ip: a.ip }) });
    n.on('click', () => { show(); win.webContents.executeJavaScript('window.openRemoteAccess?.()').catch(() => {}); });
    n.show();
    win?.flashFrame(true);
  }
}

// --- Window -----------------------------------------------------------------------------------

function show() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  if (toMaximize) { toMaximize = false; win.maximize(); }
  win.show();
  win.focus();
}

// Position, size, screen and maximised state of the window, restored at the next launch
const WINDOW_FILE = path.join(DASH_DIR, 'window.json');
function readPlacement() {
  try {
    const p = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8'));
    // The screen it was on may have been unplugged: the position is kept only if it falls on a present screen
    const area = screen.getDisplayMatching(p.bounds).workArea;
    const visible = p.bounds.x < area.x + area.width - 100 && p.bounds.x + p.bounds.width > area.x + 100
      && p.bounds.y >= area.y - 10 && p.bounds.y < area.y + area.height - 100;
    return visible ? p : { maximized: p.maximized };
  } catch { return {}; }
}
let savePlacementTimer = null;
function rememberPlacement() {
  clearTimeout(savePlacementTimer);
  savePlacementTimer = setTimeout(() => {
    if (!win || win.isMinimized()) return;
    fs.mkdirSync(path.dirname(WINDOW_FILE), { recursive: true });
    // getNormalBounds: the size before maximising, to get it back when leaving full screen
    fs.writeFileSync(WINDOW_FILE, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }, null, 2));
  }, 500);
}
let toMaximize = false; // launched at Windows startup, window hidden: maximised when first opened

function createWindow() {
  const placement = readPlacement();
  win = new BrowserWindow({
    width: 1600, height: 960, ...placement.bounds, title: t('electron.appName'), icon: APP_ICON, autoHideMenuBar: true, show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      // Read by preload.cjs: in remote mode, the actions on this computer are not offered to the page
      additionalArguments: remote() ? ['--dash-remote'] : [],
    },
  });
  if (placement.maximized && AT_STARTUP) toMaximize = true;
  else if (placement.maximized) win.maximize(); // maximising shows it
  else if (!AT_STARTUP) win.show();
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, rememberPlacement);
  win.loadURL(base());
  // Links leaving the app (external URLs, files to open) go to the default browser
  // Only http(s) leaves for the browser: another scheme (file:, ms-settings:, a custom protocol…) could run something
  const openOutside = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  const sameOrigin = url => { try { return new URL(url).origin === new URL(base()).origin; } catch { return false; } };
  // The window itself stays on the dashboard (local page or the configured server)
  win.webContents.on('will-navigate', (e, url) => { if (!sameOrigin(url)) { e.preventDefault(); openOutside(url); } });
  // Closing the window hides it: the app stays in the notification area
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  // The window gets the focus back: so does the content (otherwise input fields can stay deaf to the keyboard)
  win.on('focus', () => { win.flashFrame(false); win.webContents.focus(); });
  // Browser shortcuts: F5 / Ctrl+R reloads, Ctrl+F5 without cache, F12 developer tools
  win.webContents.on('before-input-event', (e, k) => {
    if (k.type !== 'keyDown') return;
    if (k.key === 'F5' || (k.control && k.key.toLowerCase() === 'r')) {
      e.preventDefault();
      if (k.control && k.key === 'F5') win.webContents.reloadIgnoringCache(); else win.webContents.reload();
    } else if (k.key === 'F12') { e.preventDefault(); win.webContents.toggleDevTools(); }
  });
}

// Actions on the computer requested by the page (preload.cjs). In remote mode the paths are those of the server:
// the actions on this computer are refused (the preload does not offer them either)
ipcMain.handle('show-in-explorer', (_, p) => { if (remote()) return; shell.showItemInFolder(path.normalize(String(p))); });
ipcMain.handle('open-external', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
// With the default app: only documents and media, never a network path (same list as server/routes/desktop.mjs)
const OPENABLE = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|svg|txt|md|csv|tsv|json|log|xml|ya?ml|html?|docx|xlsx|pptx|odt|ods|odp|rtf|mp4|mov|avi|mkv|webm|mp3|wav|ogg|flac|m4a)$/i;
// Electron flaw on Windows: after alert() / confirm(), the keyboard does not come back to the page; losing and
// regaining the focus (what Alt+Tab does) gives it back
ipcMain.handle('restore-focus', () => {
  if (!win || win.isDestroyed()) return;
  win.blur();
  win.focus();
  win.webContents.focus();
});
// Native Windows folder picker to add a project (handier than typing a path)
ipcMain.handle('choose-folder', async () => {
  if (remote()) return null;
  const r = await dialog.showOpenDialog(win, { title: t('electron.dialog.projectFolder'), properties: ['openDirectory'] });
  return r.canceled || !r.filePaths?.length ? null : r.filePaths[0];
});
ipcMain.handle('open-with-default', async (_, p) => {
  if (remote()) return t('electron.remoteRefused');
  const c = path.normalize(String(p));
  if (/^[\\/]{2}/.test(String(p))) return t('electron.openRefused'); // network path (UNC)
  let dir = false;
  try { dir = fs.statSync(c).isDirectory(); } catch { /* missing: openPath reports it */ }
  if (!dir && !OPENABLE.test(c)) return t('electron.openRefused');
  return shell.openPath(c); // '' if opened, otherwise the error message
});

// --- Startup ---------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.setAppUserModelId('claude-dashboard'); // Windows notifications attached to the app
  app.whenReady().then(async () => {
    ({ t } = await loadI18n(app));
    tray = new Tray(trayIcon(false));
    tray.setToolTip(t('electron.tooltip.starting'));
    tray.on('click', show);
    // Remote mode: nothing to start here, the dashboard runs on the server
    if (!remote() && !(await ensureServer())) tray.setToolTip(t('electron.tooltip.unreachable'));
    // Old startup registration without the argument: redone with it, to start with the window hidden
    if (app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: false });
      app.setLoginItemSettings({ openAtLogin: true, args: STARTUP_ARGS });
    }
    createWindow();
    watchReload();
    poll();
    setInterval(poll, 5000);
  });
  app.on('window-all-closed', e => e.preventDefault()); // stays in the notification area
  app.on('before-quit', () => { quitting = true; });
}
