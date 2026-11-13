// Engine (engine.mjs): knowing whether it runs, starting it, relaying requests to it.
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENGINE_PORT, ENGINE_TOKEN_HEADER, sendJson, engineToken } from '../common.mjs';
import { t } from '../public/i18n/index.js';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
/** Headers of a request to the engine: its token (it refuses any other caller), plus `extra`. */
export const engineHeaders = (extra = {}) => ({ ...extra, [ENGINE_TOKEN_HEADER]: engineToken() });

// --- Engine ------------------------------------------------------------------------------------

export async function engineAlive() {
  try { return (await fetch(`${ENGINE}/api/ping`, { headers: engineHeaders(), signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}
/** Starts the engine if it is not running (detached process: it outlives the page). */
export async function ensureEngine() {
  if (await engineAlive()) return true;
  spawn(process.execPath, [path.join(HERE, 'engine.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await engineAlive()) return true;
  }
  return false;
}
export async function engine(route, options = {}) {
  const r = await fetch(`${ENGINE}${route}`, { ...options, headers: engineHeaders({ ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }) });
  return r.json();
}
export const notifyChange = () => fetch(`${ENGINE}/api/signal`, { method: 'POST', headers: engineHeaders() }).catch(() => {});

// Event streams relayed to the browsers (engine response → browser response), told before the page stops
const streams = new Map();
/** Tells the open pages that the dashboard restarts (update): on mobile they show a waiting screen, then reload. */
export function announceRestart() {
  for (const [from, res] of streams) { from.unpipe(res); res.write('event: restarting\ndata: page\n\n'); }
}

/** Relays the request as is to the engine (SSE included: the response is copied as it comes). */
export function relay(req, res) {
  // x-dash-origin (pc, wifi, internet): set here, never the one a browser would send
  const to = http.request(`${ENGINE}${req.url}`, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${ENGINE_PORT}`, 'x-dash-origin': req.origin || 'pc', [ENGINE_TOKEN_HEADER]: engineToken() } }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
    if (String(r.headers['content-type']).startsWith('text/event-stream')) {
      streams.set(r, res);
      res.on('close', () => streams.delete(r));
    }
  });
  to.on('error', async e => {
    console.warn(`relay ${req.url}: ${e.message}`);
    if (res.headersSent) { res.end(); return; }
    sendJson(res, 502, { error: t('server.errors.engineUnreachable', { message: e.message }) });
    ensureEngine();
  });
  res.on('close', () => { if (!res.writableEnded) to.destroy(); }); // client gone (SSE closed): cut the relay
  req.pipe(to);
}
