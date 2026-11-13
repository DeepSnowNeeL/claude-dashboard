import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../server/router.mjs';

const h = name => () => name;
const name = r => r?.handler();

test('exact match', () => {
  const r = createRouter({ 'GET /api/x': h('x') });
  assert.equal(name(r.find('GET', '/api/x')), 'x');
  assert.equal(r.find('POST', '/api/x'), null);
  assert.equal(r.find('GET', '/api/x/y'), null);
});

test('a specific method wins over *', () => {
  const r = createRouter({ '* /api/x': h('all'), 'GET /api/x': h('get') });
  assert.equal(name(r.find('GET', '/api/x')), 'get');
  assert.equal(name(r.find('POST', '/api/x')), 'all');
});

test(':id captures a non-empty segment, the number of segments must match', () => {
  const r = createRouter({ 'POST /api/access/devices/:id/approve': h('ok') });
  const found = r.find('POST', '/api/access/devices/abc/approve');
  assert.equal(name(found), 'ok');
  assert.deepEqual(found.params, { id: 'abc' });
  assert.equal(r.find('POST', '/api/access/devices//approve'), null);
  assert.equal(r.find('POST', '/api/access/devices/x/approve/extra'), null);
  assert.equal(r.find('POST', '/api/access/devices/approve'), null);
});

test('a /* prefix captures all the rest', () => {
  const r = createRouter({ 'GET /f/*': h('f') });
  const found = r.find('GET', '/f/a/b/c.html');
  assert.equal(name(found), 'f');
  assert.deepEqual(found.params, { '*': 'a/b/c.html' });
  assert.equal(r.find('GET', '/other/a'), null);
});

test('%2f stays in a single segment', () => {
  const r = createRouter({ 'GET /api/s/:id/feed': h('feed') });
  const found = r.find('GET', '/api/s/a%2fb/feed');
  assert.equal(name(found), 'feed');
  assert.deepEqual(found.params, { id: 'a%2fb' });
});

test('a key declared twice makes the creation fail', () => {
  assert.throws(() => createRouter({ 'GET /api/x': h(1) }, { 'GET /api/x': h(2) }), /GET \/api\/x/);
  assert.throws(() => createRouter({ 'GET /api/:a': h(1) }, { 'GET /api/:a': h(2) }));
});
