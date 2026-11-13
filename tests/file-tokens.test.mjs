// Read tokens of the internet gate: the resources of a sandboxed HTML page (opaque origin, no login cookie) load
// under a signed prefix, tied to an approved device and to one allowed root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data folder, and an engine port nobody listens on: the allowed roots are then ~/.claude-dashboard only
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tokens-'));
process.env.DASH_DIR = DIR;
process.env.DASH_PORT = '59990';
process.env.DASH_PORT_ENGINE = '59991';
const { tokenedPath, untoken, requestedFile } = await import('../server/file-tokens.mjs');
const { remoteGate } = await import('../server/remote.mjs');

const SECRET = 'cookie-secret';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const writeDevices = devices => fs.writeFileSync(path.join(DIR, 'access.json'), JSON.stringify({ devices }));
const phone = { id: 'abc123', token: hash(SECRET), approved: true, seen: new Date().toISOString(), created: new Date().toISOString() };
writeDevices([phone]);

const page = path.join(DIR, 'mockups', 'page.html');
const url = file => '/api/file/' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');

test('requestedFile', () => {
  assert.equal(requestedFile('/api/file/E%3A/a/b.html'), 'E:/a/b.html');
  assert.equal(requestedFile('/f/2688-quiz/E:/a/b.html'), 'E:/a/b.html');
  assert.equal(requestedFile('/api/sessions'), null);
});

test('a token opens the files of its root, and only them', async () => {
  const tokened = await tokenedPath(url(page), page, phone);
  assert.match(tokened, /^\/api\/file\/~abc123\.[a-z0-9]+\.[\w-]+\//);
  assert.deepEqual(await untoken(tokened), { path: url(page), valid: true });
  // Relative resource of the page: same prefix, same root
  const prefix = tokened.slice(0, tokened.indexOf('/', '/api/file/~'.length) + 1);
  const img = path.join(DIR, 'mockups', 'img', 'logo.png');
  assert.equal((await untoken(prefix + url(img).slice('/api/file/'.length))).valid, true);
  // Outside the roots: no token issued, and a token does not reach it
  const outside = path.join(os.tmpdir(), 'elsewhere.png');
  assert.equal(await tokenedPath(url(outside), outside, phone), null);
  assert.equal((await untoken(prefix + url(outside).slice('/api/file/'.length))).valid, false);
});

test('mockup route keeps its slug', async () => {
  const p = '/f/2688-quiz/' + page.replace(/\\/g, '/');
  const tokened = await tokenedPath(p, page, phone);
  assert.match(tokened, /^\/f\/~abc123\.[^/]+\/2688-quiz\//);
  assert.deepEqual(await untoken(tokened), { path: p, valid: true });
});

test('tampered, expired or revoked token: refused', async () => {
  const tokened = await tokenedPath(url(page), page, phone);
  assert.equal((await untoken(tokened.replace(/\.([\w-])([\w-]*)\//, (m, a, b) => `.${a === 'A' ? 'B' : 'A'}${b}/`))).valid, false);
  const now = Date.now;
  Date.now = () => now() + 13 * 3600_000;
  try { assert.equal((await untoken(tokened)).valid, false); } finally { Date.now = now; }
  writeDevices([]);
  try { assert.equal((await untoken(tokened)).valid, false); } finally { writeDevices([phone]); }
  assert.equal(await untoken('/api/file/E:/a.png'), null);
});

// Minimal request / response for the gate
function call(p, cookie) {
  const req = { method: 'GET', url: p, headers: { host: 'dash.example.com', ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: '127.0.0.1' } };
  const res = { status: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(s, h) { this.status = s; Object.assign(this.headers, h); }, end() {} };
  return { req, res };
}

test('gate: the page is redirected under a token, its resources load without the cookie', async () => {
  const cookie = `dash_device=abc123.${SECRET}`;
  const { req, res } = call(url(page) + '?v=2', cookie);
  assert.equal(await remoteGate(req, res, url(page)), true);
  assert.equal(res.status, 302);
  assert.match(res.headers.Location, /^\/api\/file\/~abc123\..+\?v=2$/);
  // Resource of the sandboxed page: no cookie, the token is enough and is stripped for the routes
  const prefix = res.headers.Location.slice(0, res.headers.Location.indexOf('/', '/api/file/~'.length) + 1);
  const css = prefix + url(path.join(DIR, 'mockups', 'style.css')).slice('/api/file/'.length);
  const r2 = call(css);
  assert.equal(await remoteGate(r2.req, r2.res, css), false);
  assert.equal(r2.req.url, url(path.join(DIR, 'mockups', 'style.css')));
  // Non-HTML file with the cookie: served as is, no redirect
  const png = url(path.join(DIR, 'mockups', 'a.png'));
  const r3 = call(png, cookie);
  assert.equal(await remoteGate(r3.req, r3.res, png), false);
  // Bad token and no cookie: login required
  const r4 = call(css.replace('~abc123.', '~zzz999.'));
  assert.equal(await remoteGate(r4.req, r4.res, r4.req.url), true);
  assert.equal(r4.res.status, 401);
});
