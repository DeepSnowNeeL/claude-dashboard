// Dashboard page: the page files, the project tree, history, subscription usage, and relay to the engine
// (engine.mjs) for everything about sessions. It holds no session: it can be restarted at will (`dash.mjs restart`)
// without cutting anything, the browser page reconnects by itself.
// Routes are declared by topic in server/routes/; here: the order of the checks, startup and listeners.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migration.mjs';
import { PAGE_PORT, ENGINE_PORT, SERVER_MODE, WORKSPACE_DIR, EXTRA_HOSTS, sendJson, norm, serveFile, applyLanguage, engineToken } from './common.mjs';
import { hostAllowed, splitHost, requestError } from './server/request-guard.mjs';
import { t } from './public/i18n/index.js';

// Before anything reads ~/.claude-dashboard (the other modules read some files when they load, e.g. network.json):
// data of a French install renamed and converted, then the interface language
migrate();
applyLanguage();

const [
  { createRouter }, { ensureEngine, relay }, { LAN, lanAddresses, isLocal, isPrivate, logDevice }, { ensureCaddy },
  { remoteGate, startRemote }, access,
  { default: sessionRoutes }, { default: gitRoutes }, { default: explorerRoutes }, { default: fileRoutes },
  { default: projectRoutes }, { default: accessRoutes }, { default: optionRoutes }, { default: desktopRoutes },
] = await Promise.all([
  import('./server/router.mjs'), import('./server/engine-client.mjs'), import('./server/network.mjs'), import('./server/caddy.mjs'),
  import('./server/remote.mjs'), import('./access.mjs'),
  import('./server/routes/sessions.mjs'), import('./server/routes/git.mjs'), import('./server/routes/explorer.mjs'), import('./server/routes/files.mjs'),
  import('./server/routes/projects.mjs'), import('./server/routes/access.mjs'), import('./server/routes/options.mjs'), import('./server/routes/desktop.mjs'),
]);

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const router = createRouter(sessionRoutes, gitRoutes, explorerRoutes, fileRoutes, projectRoutes, optionRoutes, desktopRoutes);
const accessRouter = createRouter(accessRoutes);

async function handle(req, res, external = false) {
  // Host: a foreign domain resolved to this machine (DNS rebinding) is refused. The gate (internet) is checked against
  // DASH_HOSTS only when it is set: there, nothing goes through without an approved device cookie, which such a
  // domain never carries.
  const hostOk = external ? (!EXTRA_HOSTS.length || EXTRA_HOSTS.includes(splitHost(req.headers.host)?.name))
    : hostAllowed(req.headers.host, { port: PAGE_PORT, ipLiterals: LAN, anyPort: EXTRA_HOSTS });
  if (!hostOk) return sendJson(res, 403, { error: t('server.errors.hostRefused') });
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (external && (await remoteGate(req, res, p))) return;
  // Request forged by another website (the gate checks the Origin itself, and requires a login)
  const forged = !external && requestError({ method: req.method, path: p, headers: req.headers, loopback: isLocal(req.socket.remoteAddress) });
  if (forged) return sendJson(res, 403, { error: t(`server.errors.${forged === 'origin' ? 'originRefused' : forged === 'crossSite' ? 'crossSiteRefused' : 'contentTypeRefused'}`) });
  const remote = !external && !isLocal(req.socket.remoteAddress);
  req.fromPc = !external && !remote; // isPathAllowed: from the PC, files outside the projects open too
  req.origin = external ? 'internet' : remote ? 'wifi' : 'pc'; // relayed to the engine (Remote pilot, Globetrotter achievements)
  if (remote) logDevice(req, isPrivate(req.socket.remoteAddress));
  if (remote && !isPrivate(req.socket.remoteAddress)) { res.writeHead(403); return res.end(t('server.errors.refused')); }
  if (p.startsWith('/api/access')) {
    // Server mode: an approved device (it went through the gate) manages access too, approving the next ones
    if (remote || (external && !SERVER_MODE)) return sendJson(res, 403, { error: t('server.errors.pcOnly') });
    const r = accessRouter.find(req.method, p);
    return r ? r.handler(req, res, { p, url, params: r.params, external, remote }) : sendJson(res, 404, { error: t('server.errors.notFound') });
  }

  // Stopping the page or the engine, opening a terminal, the explorer or VS Code: from the PC only
  if (remote && (/^\/api\/(stop|engine\/stop|auth\/|explorer|vscode|options|trackers|worktree\/)/.test(p))) return sendJson(res, 403, { error: t('server.errors.pcOnly') });
  // Adding or removing a project folder (any folder of the machine enters the allowed paths): from the PC only, and
  // from approved devices in server mode, which have the rights of the PC
  if ((remote || (external && !SERVER_MODE)) && p === '/api/projects' && req.method !== 'GET') return sendJson(res, 403, { error: t('server.errors.pcOnly') });

  const route = router.find(req.method, p);
  if (route) return route.handler(req, res, { p, url, params: route.params, external, remote });

  // Sessions, event stream, mockup files: to the engine
  if (p.startsWith('/api/') || p.startsWith('/f/')) return relay(req, res);

  // Page
  if (req.method === 'GET') {
    const f = path.join(PUBLIC, p === '/' ? 'index.html' : p);
    if (!norm(f).startsWith(norm(PUBLIC))) { res.writeHead(403); res.end(); return; }
    return serveFile(res, f);
  }

  res.writeHead(405);
  res.end();
}

// Server mode: master password given by the environment (Docker), only if none is set yet
if (SERVER_MODE) {
  const r = access.bootstrapPassword(process.env.DASH_PASSWORD);
  if (r === 'set') console.log('Master password set from DASH_PASSWORD');
  else if (r !== 'kept') console.error(`DASH_PASSWORD ignored: ${r}`);
  console.log(`Server mode: workspace ${WORKSPACE_DIR}`);
}

engineToken(); // created here if missing: the engine accepts only the page (server/engine-client.mjs)
await ensureEngine();
// The engine can stop by itself (deferred stop): the page restarts it within seconds. No Caddy in server mode: the
// user's own reverse proxy terminates HTTPS.
setInterval(() => { ensureEngine(); if (!SERVER_MODE) ensureCaddy(); }, 5000);
if (!SERVER_MODE) ensureCaddy();
startRemote(handle);
http.createServer((req, res) => handle(req, res).catch(e => sendJson(res, 500, { error: e.message })))
  // Unreadable request from elsewhere (e.g. the phone trying https): logged too
  .on('clientError', (e, socket) => {
    if (!isLocal(socket.remoteAddress)) logDevice({ socket, method: 'ERROR', url: e.code, headers: {} }, isPrivate(socket.remoteAddress));
    socket.destroy();
  })
  .listen(PAGE_PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Dashboard: http://localhost:${PAGE_PORT} (engine on ${ENGINE_PORT})`);
    if (LAN) console.log(`Local network (no authentication): ${lanAddresses().map(a => `http://${a}:${PAGE_PORT}`).join(', ')}`);
  });
