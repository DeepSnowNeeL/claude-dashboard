// Access from the internet (port 4749, behind Caddy): master password and devices approved from the PC.
// Everything is in ~/.claude-dashboard/access.json: the hashed password (scrypt), and for each device its hashed
// token (sha256); nothing is kept in clear. A device logged in with the right password stays "pending"
// until it is approved from the PC.
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR } from './common.mjs';
import crypto from 'node:crypto';
import { t } from './public/i18n/index.js';

const FILE = path.join(DASH_DIR, 'access.json');
const LOG = path.join(DASH_DIR, 'access.log');
export const COOKIE = 'dash_device';
export const DURATION_DAYS = 90; // an approved device stays logged in for 90 days, extended at each visit
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { devices: [] }; }
}
function write(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
const scryptAsync = (pwd, salt) => new Promise((ok, ko) => crypto.scrypt(pwd, salt, 64, SCRYPT, (err, key) => (err ? ko(err) : ok(key))));
/** Is `pwd` the master password? (async scrypt: the page keeps answering meanwhile) */
export async function checkPassword(pwd) {
  const { password } = read();
  if (!password) return false;
  const expected = Buffer.from(password.hash, 'base64');
  const computed = await scryptAsync(String(pwd || ''), Buffer.from(password.salt, 'base64'));
  return expected.length === computed.length && crypto.timingSafeEqual(expected, computed);
}
const hashToken = j => crypto.createHash('sha256').update(j).digest('hex');
export function logLine(text) {
  fs.appendFile(LOG, `${new Date().toISOString()} ${text}\n`, () => {});
}

// --- Configuration (from the PC) --------------------------------------------------------------

export function config() {
  const e = read();
  return { password: !!e.password, domain: e.domain || '', relays: e.relays || [], viaRelay: e.viaRelay || '', httpPort: e.httpPort || null };
}
/**
 * `httpPort: 80`: this PC receives port 80 from the box and Let's Encrypt validates through it (HTTP-01). For a second
 * PC behind the same box, whose HTTPS comes through another port (e.g. 8443 → 443 of this PC): it stays standalone.
 */
export function setHttpPort(port) {
  const e = read();
  e.httpPort = Number(port) === 80 ? 80 : null;
  write(e);
}

// --- Several PCs behind a single box -----------------------------------------------------------
// The box forwards 443 to one PC only: its Caddy also serves the subdomains of the other PCs (`relays`) and relays
// them on the local network. A PC reached this way (`viaRelay` = IP of the relay PC) does not start Caddy and opens
// its remote port to that IP only; it keeps its own login (password, devices approved from its screen).

const LOCAL_IPV4 = /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){2,3}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/** `relays`: `[{ domain, target }]`, `target` = local IP of the other PC (its remote port is the same as this one's). */
export function setRelays(relays) {
  const clean = (Array.isArray(relays) ? relays : []).map(r => ({ domain: String(r?.domain || '').trim().toLowerCase(), target: String(r?.target || '').trim() }))
    .filter(r => r.domain || r.target);
  for (const r of clean) {
    if (!DOMAIN.test(r.domain)) throw new Error(t('access.errors.invalidRelayDomain', { domain: r.domain || t('access.errors.empty') }));
    if (!LOCAL_IPV4.test(r.target)) throw new Error(t('access.errors.invalidRelayTarget', { domain: r.domain }));
  }
  const e = read();
  e.relays = clean;
  write(e);
}
/** Local IP of the relay PC (empty: this PC is not reached through a relay). */
export function setViaRelay(ip) {
  const v = String(ip || '').trim();
  if (v && !LOCAL_IPV4.test(v)) throw new Error(t('access.errors.invalidRelayIp'));
  const e = read();
  e.viaRelay = v;
  write(e);
}
export function setPassword(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 12) throw new Error(t('access.errors.passwordTooShort'));
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd, salt, 64, SCRYPT);
  const e = read();
  e.password = { salt: salt.toString('base64'), hash: hash.toString('base64') };
  // New password: every device must log in again
  e.devices = [];
  write(e);
  logLine('password changed, devices logged out');
}
export function setDomain(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(t('access.errors.invalidDomain'));
  const e = read();
  e.domain = d;
  write(e);
}

// --- Lockouts ----------------------------------------------------------------------------------
// Per IP only (a global cut would let anyone lock the owner out): 5 failures lock the IP for 15 min, each new lockout
// of the same IP lasts twice as long (24 h at most). An attempt counts as a failure as soon as it starts, before the
// password is checked: parallel requests cannot try more than the limit.

const failuresByIp = new Map(); // ip → { n, until, strikes, last }
const LOCK_MINUTES = 15, MAX_LOCK_MINUTES = 24 * 60;

export function blockedMinutes(ip) {
  const e = failuresByIp.get(ip);
  const now = Date.now();
  return e && e.until > now ? Math.ceil((e.until - now) / 60000) : 0;
}
/** Counts an attempt of `ip` as a failure (undone by a right password). */
function recordFailure(ip) {
  const now = Date.now();
  // Forgotten IPs (nothing for a day): the map does not grow forever
  if (failuresByIp.size > 1000) for (const [k, v] of failuresByIp) if (now - v.last > 86400_000) failuresByIp.delete(k);
  const e = failuresByIp.get(ip) || { n: 0, until: 0, strikes: 0, last: now };
  if (now - e.last > 86400_000) Object.assign(e, { n: 0, strikes: 0 }); // quiet for a day: back to the first delay
  e.n++;
  e.last = now;
  if (e.n >= 5) {
    const minutes = Math.min(LOCK_MINUTES * 2 ** e.strikes, MAX_LOCK_MINUTES);
    e.until = now + minutes * 60000;
    e.n = 0;
    e.strikes++;
    logLine(`${ip} locked for ${minutes} min`);
  }
  failuresByIp.set(ip, e);
}
/** Right password: the attempt counted when it started is withdrawn, the IP keeps its earlier lockouts. */
function cancelFailure(ip) {
  const e = failuresByIp.get(ip);
  if (e && e.n > 0) e.n--;
}

// --- Login -------------------------------------------------------------------------------------

/** Checks the password; if it is right, creates a pending device and returns the cookie to set. */
export async function login(pwd, { ip, ua }) {
  const minutes = blockedMinutes(ip);
  if (minutes) return { error: t('access.errors.tooManyAttempts', { minutes }), blocked: true };
  if (!read().password) return { error: t('access.errors.notConfigured') };
  recordFailure(ip); // counted before the (slow) check: see Lockouts
  if (!(await checkPassword(pwd))) {
    logLine(`${ip} password refused (${ua})`);
    return { error: t('access.errors.wrongPassword') };
  }
  cancelFailure(ip);
  const e = read();
  const id = crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(32).toString('base64url');
  e.devices = (e.devices || []).filter(a => a.approved || Date.now() - Date.parse(a.created) < 24 * 3600_000); // pending for more than a day: forgotten
  const code = newCode(e.devices);
  e.devices.push({ id, code, token: hashToken(token), name: deviceName(ua), ua, ip, created: new Date().toISOString(), seen: new Date().toISOString(), approved: false });
  write(e);
  logLine(`${ip} password accepted, device ${id} pending, code ${code} (${ua})`);
  return { cookie: `${id}.${token}`, id };
}

/** Device of the cookie (approved or not), or null; updates the last visit. */
export function cookieOf(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : '';
}
export function deviceOf(req) {
  const [id, token] = cookieOf(req).split('.');
  if (!id || !token) return null;
  const e = read();
  const a = (e.devices || []).find(x => x.id === id);
  if (!a) return null;
  const h1 = Buffer.from(a.token, 'hex'), h2 = Buffer.from(hashToken(token), 'hex');
  if (h1.length !== h2.length || !crypto.timingSafeEqual(h1, h2)) return null;
  if (a.approved && Date.now() - Date.parse(a.seen) > DURATION_DAYS * 86400_000) return null; // not back for 90 days
  if (Date.now() - Date.parse(a.seen) > 60_000) { a.seen = new Date().toISOString(); write(e); }
  return a;
}
/** Approved device `id` still logged in (file links signed with its key, server/file-tokens.mjs), or null. */
export function approvedDevice(id) {
  const a = (read().devices || []).find(x => x.id === id);
  return a?.approved && Date.now() - Date.parse(a.seen) <= DURATION_DAYS * 86400_000 ? a : null;
}
export function logout(id) {
  const e = read();
  e.devices = (e.devices || []).filter(a => a.id !== id);
  write(e);
}

// --- Approval codes ---------------------------------------------------------------------------
// Each device gets a short code shown on its waiting screen (login.html), to recognise it in the device list or to
// approve it from the command line (`dash.mjs devices approve <code>`, server mode). Alphabet without 0/O, 1/I/L.

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const cleanCode = c => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
function newCode(list = []) {
  for (;;) {
    const raw = Array.from(crypto.randomBytes(6), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    if (!list.some(a => cleanCode(a.code) === cleanCode(code))) return code;
  }
}
/** Device of a code (dash or case do not matter) or of an id. */
function findDevice(devices, codeOrId) {
  const c = cleanCode(codeOrId);
  return devices.find(a => (a.code && cleanCode(a.code) === c) || a.id === String(codeOrId || '').trim().toLowerCase()) || null;
}

/**
 * Sets the master password at startup (`DASH_PASSWORD`, server mode) if none is set yet: never overwrites an existing
 * one. Returns 'set', 'kept' or an error message.
 */
export function bootstrapPassword(pwd) {
  if (!pwd || read().password) return 'kept';
  try { setPassword(pwd); } catch (err) { return err.message; }
  logLine('master password set from DASH_PASSWORD');
  return 'set';
}

// --- Devices (from the PC) ---------------------------------------------------------------------

export function devices() {
  return (read().devices || []).map(({ token, ...a }) => a);
}
export function approve(id) {
  const e = read();
  const a = (e.devices || []).find(x => x.id === id);
  if (!a) return false;
  a.approved = true;
  a.approvedAt = new Date().toISOString();
  write(e);
  logLine(`device ${id} approved (${a.name})`);
  return true;
}
/** Approves a device by its code (or id); returns the device, or null. */
export function approveByCode(code) {
  const a = findDevice(read().devices || [], code);
  return a && approve(a.id) ? devices().find(x => x.id === a.id) : null;
}
/** Revokes (or refuses) a device by its code (or id); returns its name, or null. */
export function revokeByCode(code) {
  const a = findDevice(read().devices || [], code);
  return a && revoke(a.id) ? { id: a.id, code: a.code || '', name: a.name } : null;
}
export function revoke(id) {
  const e = read();
  const before = (e.devices || []).length;
  e.devices = (e.devices || []).filter(a => a.id !== id);
  write(e);
  if (e.devices.length !== before) logLine(`device ${id} revoked`);
  return e.devices.length !== before;
}

/** "Chrome · Android", "Safari · iPhone"… from the User-Agent, to recognise the device to approve. */
function deviceName(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('access.browser');
  // Chrome hides the model ("Android 10; K"): keep "Android" rather than an unreadable "K"
  const model = ua.match(/Android[^;)]*;\s*([^;)]+)/)?.[1]?.trim();
  const system = /Android/.test(ua) ? (model && model !== 'K' ? model : 'Android')
    : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
  return `${browser} · ${system}`;
}
