// Web Push (VAPID) to the phones: a notification when a session is blocked on a card (question, command to approve,
// plan) and the PC has had no keyboard or mouse action for the delay set on each device. No library: the JWT (ES256)
// and the message encryption (RFC 8291, aes128gcm) are done with node:crypto.
// State in DASH_DIR/push.json: { vapid: { publicKey, privateKey (JWK) }, subscriptions: [{ endpoint, keys, enabled, idleMinutes, ua, createdAt }] }.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DASH_DIR } from '../common.mjs';
import { t } from '../public/i18n/index.js';
import { sessions, drivers } from './registry.mjs';

const FILE = path.join(DASH_DIR, 'push.json');
const SUBJECT = 'https://github.com/DeepSnowNeeL/claude-dashboard'; // contact the push services may use (Apple wants one)
export const DEFAULT_IDLE_MINUTES = 10;
const CHECK_EVERY = 20_000;
const CARDS = ['permission', 'plan', 'question'];

const b64url = buf => Buffer.from(buf).toString('base64url');

let state = null;
function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = {}; }
  state.subscriptions ||= [];
  if (!state.vapid) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    state.vapid = { publicKey: b64url(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), privateKey: jwk };
    save();
  }
  return state;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export const publicKey = () => load().vapid.publicKey;

/** VAPID JWT (ES256) for the push service of `endpoint`. */
function vapidHeader(endpoint) {
  const { vapid } = load();
  const enc = o => b64url(JSON.stringify(o));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const key = crypto.createPrivateKey({ key: vapid.privateKey, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64url(sig)}, k=${vapid.publicKey}`;
}

/** Encrypts `payload` for a subscription (RFC 8291, aes128gcm, a single record). Exported for the tests. */
export function encrypt(payload, keys, salt = crypto.randomBytes(16)) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const uaPublic = Buffer.from(keys.p256dh, 'base64url');
  const auth = Buffer.from(keys.auth, 'base64url');
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Sends a notification to a subscription; a subscription the push service no longer knows (404, 410) is dropped. */
export async function sendPush(sub, message) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidHeader(sub.endpoint), TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: encrypt(JSON.stringify(message), sub.keys),
  });
  if (res.status === 404 || res.status === 410) { removeSubscription(sub.endpoint); return false; }
  if (!res.ok) throw new Error(`push ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return true;
}

// --- Subscriptions (one per device, identified by its endpoint) ---------------------------------------------------
const view = s => s && { enabled: s.enabled !== false, idleMinutes: s.idleMinutes ?? DEFAULT_IDLE_MINUTES };
export const deviceSettings = endpoint => view(load().subscriptions.find(s => s.endpoint === endpoint)) || null;

export function subscribe({ subscription, idleMinutes }, ua) {
  const { endpoint, keys } = subscription || {};
  if (!/^https:\/\//.test(endpoint || '') || !keys?.p256dh || !keys?.auth) return null;
  const subs = load().subscriptions;
  const old = subs.find(s => s.endpoint === endpoint);
  const entry = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, enabled: true, idleMinutes: idle(idleMinutes ?? old?.idleMinutes), ua: String(ua || '').slice(0, 200), createdAt: old?.createdAt || new Date().toISOString() };
  state.subscriptions = [...subs.filter(s => s.endpoint !== endpoint), entry];
  save();
  return view(entry);
}

export function updateSettings({ endpoint, enabled, idleMinutes }) {
  const s = load().subscriptions.find(x => x.endpoint === endpoint);
  if (!s) return null;
  if (enabled !== undefined) s.enabled = enabled !== false;
  if (idleMinutes !== undefined) s.idleMinutes = idle(idleMinutes);
  save();
  return view(s);
}

export function removeSubscription(endpoint) {
  load().subscriptions = state.subscriptions.filter(s => s.endpoint !== endpoint);
  save();
}

const idle = m => (Number.isFinite(Number(m)) && Number(m) >= 0 ? Math.min(Number(m), 24 * 60) : DEFAULT_IDLE_MINUTES);

export function testPush(endpoint) {
  const s = load().subscriptions.find(x => x.endpoint === endpoint);
  if (!s) return null;
  return sendPush(s, { title: t('engine.push.testTitle'), body: t('engine.push.testBody'), tag: 'test' });
}

// --- Activity of the PC --------------------------------------------------------------------------------------------
// Last keyboard or mouse action on the PC: reported by the app (system idle time) or by the page open on the PC.
// Unknown since the engine started: counted from the start.
let lastActivityAt = Date.now();
export function notePresence(idleMs) {
  const at = Date.now() - Math.max(0, Number(idleMs) || 0);
  if (at > lastActivityAt) lastActivityAt = at;
}

// --- Watching the blocked sessions --------------------------------------------------------------------------------
const notified = new Map(); // `${card id} ${endpoint}` → slug: one notification per card and device
// Apple's push service wants each push to show a notification (a few silent ones and the subscription is revoked):
// no close push there, the page closes them when opened (closeHandledNotifications of public/services/push.js).
const canClose = endpoint => !/\.push\.apple\.com\//.test(endpoint);

function message(slug, card) {
  const { title, ticket } = sessions.get(slug)?.data || {};
  const icon = card.t === 'permission' ? '🔐' : card.t === 'plan' ? '📋' : '❓';
  const what = card.t === 'permission' ? card.summary || card.tool
    : card.t === 'question' ? card.questions?.[0]?.question
    : '';
  return {
    title: `${icon} ${ticket ? `${ticket} · ` : ''}${title || slug}`,
    body: [t(`engine.push.${card.t}`), what].filter(Boolean).join(' : ').slice(0, 300),
    tag: slug, slug,
  };
}

async function check() {
  const subs = load().subscriptions.filter(s => s.enabled !== false);
  if (!subs.length) return;
  const idleMs = Date.now() - lastActivityAt;
  const pending = [];
  for (const [slug, p] of drivers) {
    for (const card of p.feed || []) if (card.state === 'pending' && CARDS.includes(card.t)) pending.push([slug, card]);
  }
  const live = new Set(pending.map(([, c]) => c.id));
  const blocked = new Set(pending.map(([slug]) => slug));
  const close = new Set(); // `${slug} ${endpoint}`: notification of a session that no longer waits for anything
  for (const [k, slug] of notified) {
    if (live.has(k.split(' ')[0])) continue;
    notified.delete(k);
    if (!blocked.has(slug)) close.add(`${slug} ${k.slice(k.indexOf(' ') + 1)}`);
  }
  for (const k of close) {
    const [slug, endpoint] = [k.slice(0, k.indexOf(' ')), k.slice(k.indexOf(' ') + 1)];
    const sub = subs.find(s => s.endpoint === endpoint);
    if (sub && canClose(endpoint)) sendPush(sub, { close: slug }).catch(e => console.warn(`Push close failed: ${e.message}`));
  }
  for (const [slug, card] of pending) {
    for (const sub of subs) {
      const key = `${card.id} ${sub.endpoint}`;
      if (notified.has(key) || idleMs < (sub.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000) continue;
      notified.set(key, slug);
      sendPush(sub, message(slug, card)).catch(e => console.warn(`Push failed: ${e.message}`));
    }
  }
}

export function startPush() {
  setInterval(() => check().catch(e => console.warn(`Push check: ${e.message}`)), CHECK_EVERY).unref();
}
