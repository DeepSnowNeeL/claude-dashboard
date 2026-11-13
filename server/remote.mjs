// Access from the internet: the gate (login, cookie, approved device) and the listeners of the remote port.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, readBody, serveFile, SERVER_MODE } from '../common.mjs';
import * as access from '../access.mjs';
import { rawIp, lanAddresses } from './network.mjs';
import { REMOTE_PORT } from './caddy.mjs';
import { t } from '../public/i18n/index.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// What an approved device may never do. Local mode: whatever acts on the PC or on access itself. Server mode (no PC,
// approved devices get its rights): only desktop actions (Windows explorer, VS Code, terminals) and stopping the page.
const FORBIDDEN = SERVER_MODE ? /^\/api\/(stop|explorer|vscode|auth\/)/ : /^\/api\/(stop|engine\/stop|auth\/|explorer|access|network|options|trackers)/;

// Event streams (SSE) opened through the gate, by device: logging out or revoking a device closes them at once
// (otherwise it would keep receiving the sessions' updates until it reconnects)
const streams = new Map(); // device id → Set of responses
function trackStream(id, res) {
  if (!streams.has(id)) streams.set(id, new Set());
  streams.get(id).add(res);
  res.on('close', () => { streams.get(id)?.delete(res); if (!streams.get(id)?.size) streams.delete(id); });
}
/** Closes the event streams of a device (`id`), or of every device (no `id`: password changed). */
export function closeStreams(id) {
  for (const [k, set] of streams) if (id === undefined || k === id) for (const r of set) r.destroy();
}

/**
 * Request from the internet (port REMOTE_PORT, relayed by Caddy, or by the user's reverse proxy in server mode):
 * nothing without an approved device, except login.
 * Returns true if the request was handled here (login, refusal), false if it can go on to the routes.
 */
export async function remoteGate(req, res, p) {
  // Client address: the LAST value of X-Forwarded-For, the one the closest proxy (Caddy, the user's proxy) appended;
  // the earlier ones are whatever the client sent
  const ip = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || rawIp(req.socket.remoteAddress);
  // Request forged from another site: the browser sends its Origin, which must be the page itself
  // (server mode: plain http accepted too, for a proxy that does not terminate TLS or a test on the local network)
  const sameOrigin = req.headers.origin === `https://${req.headers.host}` || (SERVER_MODE && req.headers.origin === `http://${req.headers.host}`);
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin) {
    sendJson(res, 403, { error: t('server.errors.originRefused') });
    return true;
  }
  const cookie = (value, days) => `${access.COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${days * 86400}`;
  if (p === '/access/login' && req.method === 'POST') {
    const minutes = access.blockedMinutes(ip);
    if (minutes) { sendJson(res, 429, { error: t('access.errors.tooManyAttempts', { minutes }) }); return true; }
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    // login() checks the lockout again after the body arrived, and counts the attempt before checking the password
    const r = await access.login(body.password, { ip, ua: String(req.headers['user-agent'] || '').slice(0, 300) });
    if (r.blocked) { sendJson(res, 429, { error: r.error }); return true; }
    if (r.error) { await new Promise(ok => setTimeout(ok, 800)); sendJson(res, 401, { error: r.error }); return true; }
    res.setHeader('Set-Cookie', cookie(r.cookie, access.DURATION_DAYS));
    sendJson(res, 200, { ok: true, approved: false });
    return true;
  }
  const device = access.deviceOf(req);
  if (p === '/access/status') {
    sendJson(res, 200, { connected: !!device, approved: !!device?.approved, name: device?.name, code: device && !device.approved ? device.code : undefined, serverMode: SERVER_MODE });
    return true;
  }
  if (p === '/access/logout' && req.method === 'POST') {
    if (device) { access.logout(device.id); closeStreams(device.id); access.logLine(`${ip} device ${device.id} logged out`); }
    res.setHeader('Set-Cookie', cookie('', 0));
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (!device?.approved) {
    // Interface language: the login page needs it before login (it reveals nothing)
    if (p === '/api/language' && req.method === 'GET') return false;
    if (p.startsWith('/api/') || p.startsWith('/f/')) sendJson(res, 401, { error: t('access.errors.loginRequired') });
    // Icons, PWA (offline page included) and dictionaries of the login page: loaded without a cookie (manifest) or before login, they reveal nothing
    else if (/^\/(favicon\.(ico|png)|icon-512\.png|manifest\.webmanifest|sw\.js|offline\.html|i18n\/(index|(fr|en)\/\w+)\.js)$/.test(p)) serveFile(res, path.join(PUBLIC, p));
    else serveFile(res, path.join(PUBLIC, 'login.html'));
    return true;
  }
  // Approved device: its login is extended each time the page is opened
  if (p === '/') res.setHeader('Set-Cookie', cookie(access.cookieOf(req), access.DURATION_DAYS));
  // What acts on the PC or on access itself is never done from the internet (server mode: desktop actions only)
  if (FORBIDDEN.test(p)) { sendJson(res, 403, { error: t(SERVER_MODE ? 'server.errors.desktopOnly' : 'server.errors.pcOnly') }); return true; }
  if (p === '/api/events' || p === '/api/browse/watch') trackStream(device.id, res);
  return false;
}

/**
 * Listeners of the remote port: on 127.0.0.1 (Caddy relays here), and, for a PC reached through another PC's relay,
 * on its local network addresses. `handle(req, res, external)` handles a request, provided by server.mjs.
 */
let createServer;
let relayListeners = [];
// PC reached by another PC's Caddy (⚙ Options → Remote access → "reached through a relay"): the remote port also
// listens on its local network addresses, but accepts only the relay PC. Follows the setting without restarting the page.
export function updateRelayListeners() {
  const ip = access.config().viaRelay;
  const wanted = ip ? lanAddresses() : [];
  if (relayListeners.map(e => e.address).join() === wanted.join()) return;
  for (const e of relayListeners) e.server.close();
  relayListeners = wanted.map(address => {
    const server = createServer()
      .on('connection', socket => { if (rawIp(socket.remoteAddress) !== access.config().viaRelay) socket.destroy(); })
      .on('error', () => {});
    server.listen(REMOTE_PORT, address);
    return { address, server };
  });
}

export function startRemote(handle) {
  // Access from the internet: Caddy relays here, login required on every route (remoteGate)
  createServer = () => http.createServer((req, res) => handle(req, res, true).catch(e => sendJson(res, 500, { error: e.message })))
    .on('clientError', (e, socket) => socket.destroy());
  // Server mode: the gate is the only door of the container, on every interface (the user's proxy relays here)
  if (SERVER_MODE) {
    createServer().listen(REMOTE_PORT, '0.0.0.0', () => console.log(`Gate (login required): http://0.0.0.0:${REMOTE_PORT}`));
    return;
  }
  createServer().listen(REMOTE_PORT, '127.0.0.1');
  updateRelayListeners();
  setInterval(updateRelayListeners, 5000);
}
