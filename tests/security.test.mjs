// Security checks: Host / Origin of the requests, sensitive files, fields of update_board, URLs of the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hostAllowed, requestError, splitHost } from '../server/request-guard.mjs';
import { isSensitive } from '../server/sensitive.mjs';
import { boardFields } from '../engine/board-fields.mjs';
import { safeUrl } from '../public/core/dom.js';
import { sameToken } from '../common.mjs';

test('splitHost', () => {
  assert.deepEqual(splitHost('LocalHost:4747'), { name: 'localhost', port: 4747 });
  assert.deepEqual(splitHost('[::1]:4747'), { name: '[::1]', port: 4747 });
  assert.deepEqual(splitHost('example.com'), { name: 'example.com', port: null });
  assert.equal(splitHost(''), null);
});

test('hostAllowed: loopback names with the right port only', () => {
  const o = { port: 4747 };
  assert.ok(hostAllowed('localhost:4747', o));
  assert.ok(hostAllowed('127.0.0.1:4747', o));
  assert.ok(hostAllowed('[::1]:4747', o));
  assert.ok(!hostAllowed('localhost:4748', o));
  assert.ok(!hostAllowed('localhost', o));
  assert.ok(!hostAllowed('evil.example:4747', o)); // DNS rebinding
  assert.ok(!hostAllowed(undefined, o));
  assert.ok(!hostAllowed('10.0.0.10:4747', o));
});

test('hostAllowed: local network mode accepts IP addresses, never a domain', () => {
  const o = { port: 4747, ipLiterals: true };
  assert.ok(hostAllowed('10.0.0.10:4747', o));
  assert.ok(hostAllowed('[fe80::1]:4747', o));
  assert.ok(!hostAllowed('10.0.0.10:9999', o));
  assert.ok(!hostAllowed('rebind.evil.example:4747', o));
});

test('hostAllowed: DASH_HOSTS names, whatever the port', () => {
  const o = { port: 4747, anyPort: ['dash.example.com'] };
  assert.ok(hostAllowed('dash.example.com', o));
  assert.ok(hostAllowed('DASH.example.com:8443', o));
  assert.ok(!hostAllowed('other.example.com', o));
});

const page = { host: 'localhost:4747' };
test('requestError: reads pass, unless cross-site on the API', () => {
  assert.equal(requestError({ method: 'GET', path: '/api/sessions', headers: page, loopback: true }), null);
  assert.equal(requestError({ method: 'GET', path: '/api/sessions/x/mcp', headers: { ...page, 'sec-fetch-site': 'cross-site' }, loopback: true }), 'crossSite');
  // A mockup in a sandbox (opaque origin) loads its own resources: cross-site, allowed on the file routes
  assert.equal(requestError({ method: 'GET', path: '/f/x/E:/a/style.css', headers: { ...page, 'sec-fetch-site': 'cross-site' }, loopback: true }), null);
  assert.equal(requestError({ method: 'GET', path: '/api/file/E:/a/img.png', headers: { ...page, 'sec-fetch-site': 'cross-site' }, loopback: true }), null);
  assert.equal(requestError({ method: 'GET', path: '/', headers: { ...page, 'sec-fetch-site': 'cross-site' }, loopback: true }), null);
});

test('requestError: writes need the page Origin, or no Origin from this machine', () => {
  const json = { ...page, 'content-type': 'application/json', 'content-length': '10' };
  assert.equal(requestError({ method: 'POST', headers: { ...json, origin: 'http://localhost:4747' }, loopback: true }), null);
  assert.equal(requestError({ method: 'POST', headers: { ...json, origin: 'https://evil.example' }, loopback: true }), 'origin');
  assert.equal(requestError({ method: 'POST', headers: { ...json, origin: 'null' }, loopback: true }), 'origin');
  assert.equal(requestError({ method: 'DELETE', headers: { ...page, origin: 'http://localhost:4747' }, loopback: true }), null);
  // Command line (no Origin): from this machine only
  assert.equal(requestError({ method: 'POST', headers: json, loopback: true }), null);
  assert.equal(requestError({ method: 'POST', headers: json, loopback: false }), 'origin');
  assert.equal(requestError({ method: 'POST', headers: page, loopback: true }), null); // no body
});

test('requestError: a body is JSON, or a raw upload marked x-dash', () => {
  const base = { ...page, origin: 'http://localhost:4747', 'content-length': '12' };
  assert.equal(requestError({ method: 'POST', headers: { ...base, 'content-type': 'text/plain' }, loopback: true }), 'contentType');
  assert.equal(requestError({ method: 'POST', headers: { ...base, 'content-type': 'application/x-www-form-urlencoded' }, loopback: true }), 'contentType');
  assert.equal(requestError({ method: 'POST', headers: { ...base, 'content-type': 'application/json; charset=utf-8' }, loopback: true }), null);
  assert.equal(requestError({ method: 'POST', headers: { ...base, 'content-type': 'image/png', 'x-dash': '1' }, loopback: true }), null);
  assert.equal(requestError({ method: 'POST', headers: { host: 'localhost:4747', 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }, loopback: true }), 'contentType');
});

test('sameToken', () => {
  assert.ok(sameToken('a'.repeat(64), 'a'.repeat(64)));
  assert.ok(!sameToken('a'.repeat(64), 'b'.repeat(64)));
  assert.ok(!sameToken(undefined, 'a'));
  assert.ok(!sameToken('', ''));
});

test('isSensitive: names', () => {
  const dashDir = path.join(os.tmpdir(), 'dash-test-none');
  const s = (f, fromPc = true) => isSensitive(f, { fromPc }, { dashDir });
  assert.ok(s('/home/u/.ssh/id_rsa'));
  assert.ok(s('/srv/app/.env'));
  assert.ok(s('/srv/app/server.pem'));
  assert.ok(s('/srv/app/my-secret.txt'));
  assert.ok(s(path.join(dashDir, 'access.json')));
  assert.ok(s(path.join(dashDir, 'engine-token')));
  assert.ok(!s('/srv/app/settings.local'));
  assert.ok(s('/srv/app/settings.local', false));
  assert.ok(!s('/srv/app/readme.md'));
});

test('isSensitive: Windows alternate streams and device paths', () => {
  const dashDir = 'C:\\Users\\u\\.claude-dashboard';
  const s = f => isSensitive(f, { fromPc: true }, { win: true, dashDir });
  if (process.platform !== 'win32') return; // path.resolve of a Windows path only means something on Windows
  assert.ok(s('C:\\Users\\u\\.claude-dashboard\\access.json::$DATA'));
  assert.ok(s('C:\\Users\\u\\project\\readme.md:hidden'));
  assert.ok(s('\\\\?\\C:\\Users\\u\\.claude-dashboard\\access.json'));
  assert.ok(!s('C:\\Users\\u\\project\\readme.md'));
});

test('isSensitive: an 8.3 short name gives back the long one', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-sens-'));
  try {
    // access.json of the data folder (here: `dir`), asked for by its short name ACCESS~1.JSO
    const long = path.join(dir, 'access.json');
    fs.writeFileSync(long, '{}');
    const short = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${long}") do @echo %~sI"`],
      { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }).stdout?.trim() || '';
    if (!short.includes('~')) return; // 8.3 names disabled on this volume: nothing to check
    assert.ok(isSensitive(short, { fromPc: true }, { dashDir: dir }), short);
    assert.ok(!isSensitive(path.join(dir, 'readme.md'), { fromPc: true }, { dashDir: dir }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('boardFields: the engine keys are ignored', () => {
  const { fields, ignored } = boardFields({ title: 'x', step: 'design', mode: 'all', cwd: 'C:\\', sessionId: 'abc', stats: {}, trackerPreview: {}, titlePinned: true, decisions: [] });
  assert.deepEqual(fields, { title: 'x', step: 'design', decisions: [] });
  assert.deepEqual(ignored.sort(), ['cwd', 'mode', 'sessionId', 'stats', 'titlePinned', 'trackerPreview']);
  // A prototype key never reaches the session object
  const parsed = JSON.parse('{"__proto__": {"polluted": 1}, "status": "working"}');
  const r = boardFields(parsed);
  assert.deepEqual(Object.keys(r.fields), ['status']);
  assert.equal({}.polluted, undefined);
});

test('boardFields: ticketUrl http(s) only', () => {
  assert.deepEqual(boardFields({ ticketUrl: 'https://gitlab.example.com/x/-/issues/1' }).fields, { ticketUrl: 'https://gitlab.example.com/x/-/issues/1' });
  assert.deepEqual(boardFields({ ticketUrl: 'javascript:alert(1)' }).fields, {});
  assert.deepEqual(boardFields({ ticketUrl: null }).fields, { ticketUrl: null });
  assert.deepEqual(boardFields(null).fields, {});
});

test('safeUrl', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl(' https://x.y '), 'https://x.y');
  assert.equal(safeUrl(undefined), null);
});

test('profileError: keys of steps, blocks and composite types are plain identifiers', async () => {
  const { profileError } = await import('../trackers.mjs');
  const base = { id: 'x', name: 'X', blocks: [{ key: 'notes', type: 'text' }] };
  assert.equal(profileError(base), null);
  assert.ok(profileError({ ...base, blocks: [{ key: 'a" onmouseover="x', type: 'text' }] }));
  assert.ok(profileError({ ...base, steps: [{ key: '<b>', label: 'B' }] }));
  assert.ok(profileError({ ...base, types: { 'bad type': { layout: 'cards', fields: [{ key: 'a', type: 'text' }] } } }));
  assert.ok(profileError({ ...base, blocks: [{ key: '__proto__', type: 'text' }] }));
});

test('fileHeaders: HTML and SVG from elsewhere run in a sandbox', async () => {
  const { fileHeaders } = await import('../common.mjs');
  assert.equal(fileHeaders('a.html', true)['Content-Security-Policy'], 'sandbox allow-scripts allow-popups allow-forms');
  assert.equal(fileHeaders('a.svg', true)['Content-Security-Policy'], 'sandbox allow-scripts allow-popups allow-forms');
  assert.equal(fileHeaders('a.png', true)['Content-Security-Policy'], undefined);
  assert.equal(fileHeaders('a.pdf', true)['Content-Security-Policy'], undefined); // Chrome refuses a sandboxed PDF
  assert.equal(fileHeaders('index.html')['Content-Security-Policy'], undefined); // the page itself
  assert.equal(fileHeaders('a.bin', true)['X-Content-Type-Options'], 'nosniff');
});
