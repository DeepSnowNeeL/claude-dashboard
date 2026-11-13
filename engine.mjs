// Dashboard engine: holds the driven Claude Code sessions (driver.mjs), their state and the event
// stream (SSE). It runs apart from the page (server.mjs) so that restarting the page cuts no session:
// it is only restarted for a change in driver.mjs or the engine/ folder (`dash.mjs restart-moteur`,
// which waits until everything is idle). Listens locally only; the page relays the calls to it.
// The routes are declared in engine/routes.mjs; here: loading the sessions, startup and listening.
import { migrate } from './migration.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_PORT, ENGINE_TOKEN_HEADER, sendJson, applyLanguage, engineToken, sameToken } from './common.mjs';
import { hostAllowed } from './server/request-guard.mjs';
import { t } from './public/i18n/index.js';
import { createRouter } from './server/router.mjs';
import * as trackers from './trackers.mjs';
import { sessions } from './engine/registry.mjs';
import { sseClients } from './engine/broadcast.mjs';
import { SESSIONS_DIR } from './engine/board.mjs';
import { autoArchive } from './engine/archives.mjs';
import { loadProgress, writeProgress } from './engine/progress.mjs';
import { startPlanAchievements } from './engine/plan-achievements.mjs';
import routes from './engine/routes.mjs';

// Before anything reads ~/.claude-dashboard: data from the French build is converted, then the language is set
migrate();
applyLanguage();

const router = createRouter(routes);

function loadFromDisk() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      // Cut in the middle of a turn (PC restarted, engine killed): it stays open, paused, flagged so it gets restarted
      if (data.status === 'working') Object.assign(data, { status: 'waiting', statusSummary: t('engine.status.cutAtRestart') });
      if (data.slug) sessions.set(data.slug, { data, receivedAt: data.updatedAt || fs.statSync(path.join(SESSIONS_DIR, f)).mtime.toISOString() });
    } catch (e) {
      console.warn(`File ignored ${f}: ${e.message}`);
    }
  }
}

async function handle(req, res) {
  // Only the page talks to the engine: by 127.0.0.1 (no foreign domain, DNS rebinding) and with the shared token
  // (another website open in the browser, or another program, does not know it)
  if (!hostAllowed(req.headers.host, { port: ENGINE_PORT })) return sendJson(res, 403, { error: t('server.errors.hostRefused') });
  if (!sameToken(req.headers[ENGINE_TOKEN_HEADER], engineToken())) return sendJson(res, 403, { error: t('engine.errors.tokenRefused') });
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const route = router.find(req.method, p);
  if (route) return route.handler(req, res, { p, url, params: route.params });
  res.writeHead(404);
  res.end();
}

trackers.init(); // installation already in use: it keeps its display ("Dev tracker")
loadFromDisk();
loadProgress(); // levels and achievements: a threshold changed in the definitions applies here
process.on('exit', () => { try { writeProgress(); } catch { /* disk unavailable: we lose at most one second */ } });
startPlanAchievements();
setInterval(() => { for (const r of sseClients) r.write(': ping\n\n'); }, 25000);
autoArchive();
setInterval(autoArchive, 3600_000);

http.createServer((req, res) => handle(req, res).catch(e => sendJson(res, 500, { error: e.message })))
  .listen(ENGINE_PORT, '127.0.0.1', () => console.log(`Dashboard engine: port ${ENGINE_PORT} (${sessions.size} session(s))`));
