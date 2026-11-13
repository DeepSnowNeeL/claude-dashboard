// HTTP helpers shared by the engine (engine.mjs) and the page (server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { t, setLanguage, resolveLanguage } from './public/i18n/index.js';

/** Data folder of the installation; DASH_DIR allows an isolated test instance. */
export const DASH_DIR = process.env.DASH_DIR || path.join(os.homedir(), '.claude-dashboard');
export const PAGE_PORT = Number(process.env.DASH_PORT || 4747);
export const ENGINE_PORT = Number(process.env.DASH_PORT_ENGINE || PAGE_PORT + 1);
export const WIN = process.platform === 'win32';

/**
 * Server mode (`DASH_MODE=server`, Docker image): no "PC", the gate on port PAGE_PORT + 2 listens on every interface
 * (behind the user's own reverse proxy) and approved devices get the rights of the PC, except desktop actions.
 */
export const SERVER_MODE = process.env.DASH_MODE === 'server';
/** Server mode: folder of the cloned repositories, proposed by the new session page (null in local mode). */
export const WORKSPACE_DIR = SERVER_MODE ? path.resolve(process.env.DASH_WORKSPACE || '/workspace') : null;

/**
 * Extra host names accepted by the page (`DASH_HOSTS`, comma separated: a machine name used on the local network, the
 * public name of a server behind a proxy). Besides them, the page answers only to localhost, 127.0.0.1, [::1] and, in
 * local network mode, the machine's addresses (server/request-guard.mjs).
 */
export const EXTRA_HOSTS = String(process.env.DASH_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

// --- Engine token ------------------------------------------------------------------------------
// The engine (127.0.0.1:ENGINE_PORT) only answers the page: each request carries the secret of DASH_DIR/engine-token,
// created by the first one that needs it. Read at each use (a few bytes): a token recreated while one of the two
// processes runs is picked up without a restart.

export const ENGINE_TOKEN_HEADER = 'x-dash-engine-token';
const TOKEN_FILE = path.join(DASH_DIR, 'engine-token');

/** Secret shared by the page and the engine; created (readable by this user only) if missing. */
export function engineToken() {
  try {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* not created yet */ }
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(DASH_DIR, { recursive: true });
  try { fs.writeFileSync(TOKEN_FILE, token, { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Created at the same moment by the other process: its token wins; a damaged file is replaced
    const other = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (other.length >= 32) return other;
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  }
  return token;
}

/** Constant-time comparison of a token received with the expected one. */
export function sameToken(given, expected) {
  if (typeof given !== 'string' || !given || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Possible values of the `language` option (options.json). */
export const LANGUAGE_SETTINGS = ['auto', 'fr', 'en'];

/** Language setting of the installation (`language` in options.json): auto, fr or en. */
export function languageSetting() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(DASH_DIR, 'options.json'), 'utf8')).language;
    return LANGUAGE_SETTINGS.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

/** Sets the language of this process from options.json (`auto`: the operating system locale). Returns 'fr' or 'en'. */
export function applyLanguage() {
  const lang = resolveLanguage(languageSetting(), Intl.DateTimeFormat().resolvedOptions().locale);
  setLanguage(lang);
  return lang;
}

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  // Text and code: shown as is by the browser (paths clicked in the conversation)
  ...Object.fromEntries(['.md', '.txt', '.log', '.java', '.ts', '.scss', '.xml', '.yml', '.yaml', '.sql', '.csv', '.properties', '.gradle', '.sh', '.ps1', '.py', '.vm', '.jsonl']
    .map(e => [e, 'text/plain; charset=utf-8'])),
};

export function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function readBody(req) {
  return new Promise((ok, ko) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { ko(new Error(t('server.errors.bodyTooLarge'))); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', ko);
  });
}

/** Raw body (file sent by the page), 30 MB at most. */
export function readBinary(req, max = 30 * 1024 * 1024) {
  return new Promise((ok, ko) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { ko(new Error(t('server.errors.fileTooLarge', { mb: Math.round(max / 1048576) }))); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', ko);
  });
}

export const norm = p => (WIN ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * Policy of a file that does not belong to the dashboard (mockup, file of a project, attachment): an HTML page or an
 * SVG runs in a sandbox, with an origin of its own, so its scripts cannot call the API with the page's rights.
 */
export const SANDBOX_CSP = 'sandbox allow-scripts allow-popups allow-forms';
const ACTIVE_TYPES = /^(text\/html|image\/svg\+xml|application\/(xhtml\+)?xml|text\/xml)(;|$)/;

/** Headers of a file served to the page; `sandboxed`: a file from elsewhere (see SANDBOX_CSP). */
export function fileHeaders(file, sandboxed = false) {
  const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // no-store: the page never keeps a stale app.js after a server update
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (sandboxed) {
    headers['X-Content-Type-Options'] = 'nosniff';
    if (ACTIVE_TYPES.test(type)) headers['Content-Security-Policy'] = SANDBOX_CSP;
  }
  return headers;
}

export function serveFile(res, file, { sandboxed = false } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(t('server.errors.notFound')); return; }
    res.writeHead(200, fileHeaders(file, sandboxed));
    fs.createReadStream(file).pipe(res);
  });
}
