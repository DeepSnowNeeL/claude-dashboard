// Caddy: HTTPS for access from the internet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DASH_DIR, PAGE_PORT } from '../common.mjs';
import * as access from '../access.mjs';

// --- Caddy: HTTPS for access from the internet ------------------------------------------------
// Started by the page (like the engine) as soon as a domain is configured: Let's Encrypt certificate obtained and
// renewed by Caddy on port 443 (the box forwards 443 to the PC), relay to REMOTE_PORT where everything goes through login.

export const REMOTE_PORT = PAGE_PORT + 2; // 4749, on 127.0.0.1 only
const CADDY_DIR = path.join(DASH_DIR, 'caddy');
export const caddyExe = () => [process.env.DASH_CADDY, path.join(CADDY_DIR, process.platform === 'win32' ? 'caddy.exe' : 'caddy')]
  .find(f => f && fs.existsSync(f));
/** Caddy admin API, through node:http: fetch adds Sec-Fetch headers that Caddy refuses (403). */
const caddyAdmin = (route, method = 'GET', body = null, type = 'application/json') => new Promise(ok => {
  const r = http.request({ host: '127.0.0.1', port: 2019, path: route, method, timeout: body ? 15_000 : 800, headers: body ? { 'Content-Type': type } : {} },
    rep => { rep.resume(); ok(rep.statusCode); });
  r.on('error', () => ok(0)).on('timeout', () => { r.destroy(); ok(0); });
  r.end(body || undefined);
});
export const caddyAlive = async () => (await caddyAdmin('/config/')) === 200;
/** Should Caddy run here? Not without a domain, a password or the executable, nor if this PC goes through a relay. */
const caddyWanted = () => { const c = access.config(); return !!(c.domain && c.password && caddyExe() && !c.viaRelay); };
/**
 * Caddy configuration. One block for this PC, one per other relayed PC (subdomain → its remote port on the local
 * network). Let's Encrypt validation: through 443 (TLS-ALPN, separate http_port, port 80 does not reach this PC), or
 * through 80 (`httpPort: 80`) for a PC whose HTTPS comes through another port of the box (e.g. 8443 → 443 of this
 * PC): without the http → https redirect, which would send to the wrong port.
 */
function caddyfileText() {
  const { domain, relays, httpPort } = access.config();
  const site = (name, target) => `${name} {\n\treverse_proxy ${target}\n\theader -Server\n}\n`;
  return `{\n\tadmin 127.0.0.1:2019\n\thttp_port ${httpPort === 80 ? 80 : PAGE_PORT + 3}\n${httpPort === 80 ? '\tauto_https disable_redirects\n' : ''}}\n\n`
    + site(domain, `127.0.0.1:${REMOTE_PORT}`) + relays.map(r => `\n${site(r.domain, `${r.target}:${REMOTE_PORT}`)}`).join('');
}
let caddyAttempt = 0; // Caddy that does not start (443 taken…): one attempt a minute, not every 5 s
export async function ensureCaddy(force = false) {
  if (!caddyWanted() || (await caddyAlive())) return;
  if (!force && Date.now() - caddyAttempt < 60_000) return;
  caddyAttempt = Date.now();
  fs.mkdirSync(CADDY_DIR, { recursive: true });
  fs.writeFileSync(path.join(CADDY_DIR, 'Caddyfile'), caddyfileText());
  const log = fs.openSync(path.join(CADDY_DIR, 'caddy.log'), 'a');
  spawn(caddyExe(), ['run', '--config', path.join(CADDY_DIR, 'Caddyfile'), '--adapter', 'caddyfile'], {
    cwd: CADDY_DIR, detached: true, stdio: ['ignore', log, log], windowsHide: true,
  }).unref();
}
/**
 * New configuration: hot reloaded (`/load`) if Caddy runs, never letting go of 443; stopped if it should no longer
 * run; started otherwise. (Stopping then restarting failed: Windows releases 443 too late.)
 */
export async function restartCaddy() {
  const alive = await caddyAlive();
  if (alive && !caddyWanted()) { await caddyAdmin('/stop', 'POST'); return; }
  if (alive) {
    const text = caddyfileText();
    fs.writeFileSync(path.join(CADDY_DIR, 'Caddyfile'), text);
    if ((await caddyAdmin('/load', 'POST', text, 'text/caddyfile')) === 200) return;
  }
  await ensureCaddy(true);
}
