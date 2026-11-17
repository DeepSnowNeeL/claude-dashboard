// Web Push: what a push service and a phone receive from engine/push.mjs (VAPID JWT signed with the public key, message
// readable by the subscription's keys, RFC 8291), and a dead subscription dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.DASH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-push-'));
const push = await import('../engine/push.mjs');

/** A phone: its key pair and auth secret, as PushManager.subscribe() gives them. */
function phone() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

/** Decryption on the phone side (RFC 8291). */
function decrypt(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16), idlen = body.readUInt8(20), asPublic = body.subarray(21, 21 + idlen);
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idlen);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2); // last record delimiter
  return plain.subarray(0, -1).toString();
}

test('the phone decrypts the message', () => {
  const p = phone();
  assert.equal(decrypt(push.encrypt('{"title":"é ✓"}', p.keys), p), '{"title":"é ✓"}');
});

test('sendPush: signed VAPID JWT, readable body, dead subscription dropped', async () => {
  const p = phone();
  let status = 201, got;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { got = { headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(status); res.end(); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;
  try {
    const sub = { endpoint, keys: p.keys };
    assert.equal(await push.sendPush(sub, { title: 'T', slug: 's' }), true);
    assert.equal(got.headers['content-encoding'], 'aes128gcm');
    assert.deepEqual(JSON.parse(decrypt(got.body, p)), { title: 'T', slug: 's' });

    const [, jwt, k] = got.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.equal(k, push.publicKey());
    const [h, c, sig] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, new URL(endpoint).origin);
    const pub = Buffer.from(k, 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

    // Subscription registered then gone at the push service: removed
    push.subscribe({ subscription: { endpoint: endpoint.replace('http:', 'https:'), keys: p.keys } }, 'test');
    assert.deepEqual(push.deviceSettings(endpoint.replace('http:', 'https:')), { enabled: true, idleMinutes: 10 });
    status = 410;
    assert.equal(await push.sendPush({ endpoint, keys: p.keys }, {}), false);
  } finally {
    server.close();
  }
});

test('settings of a device: delay kept, invalid value back to the default', () => {
  const p = phone();
  const endpoint = 'https://push.example/x';
  push.subscribe({ subscription: { endpoint, keys: p.keys }, idleMinutes: 0 }, 'test');
  assert.deepEqual(push.deviceSettings(endpoint), { enabled: true, idleMinutes: 0 });
  push.updateSettings({ endpoint, enabled: false, idleMinutes: 'x' });
  assert.deepEqual(push.deviceSettings(endpoint), { enabled: false, idleMinutes: 10 });
  assert.equal(push.subscribe({ subscription: { endpoint: 'http://insecure', keys: p.keys } }), null);
});
