// Phone notifications (Web Push): subscription of this device, its settings (on/off, PC idle delay), test, and the
// activity of the PC when the page is open there without the app (the app reports the idle time of the whole PC).
import { api } from '../core/api.js';
import { effect } from '../core/signals.js';
import { sessions } from '../core/state.js';

/** Why this device cannot receive notifications: 'http' (no HTTPS), 'install' (iPhone: add to home screen), 'browser', or null. */
export function pushBlocker() {
  if (!window.isSecureContext) return 'http';
  if (!('serviceWorker' in navigator)) return 'browser';
  if (!('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return ios && !navigator.standalone ? 'install' : 'browser';
  }
  return null;
}

const fromBase64Url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const registration = () => navigator.serviceWorker.ready;
export const currentSubscription = async () => (await registration()).pushManager.getSubscription();

/** Settings of this device on the PC ({ enabled, idleMinutes }), or null when it is not subscribed. */
export async function deviceSettings() {
  if (pushBlocker() || Notification.permission !== 'granted') return null;
  const sub = await currentSubscription();
  if (!sub) return null;
  return (await api('/api/push/device', { endpoint: sub.endpoint })).settings;
}

/** Asks the permission (must follow a click), subscribes the device and registers it on the PC. */
export async function enablePush(idleMinutes) {
  if (await Notification.requestPermission() !== 'granted') throw new Error('denied');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api('/api/push');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
  }
  return api('/api/push/subscribe', { subscription: sub.toJSON(), idleMinutes });
}

export async function savePushSettings(settings) {
  const sub = await currentSubscription();
  return sub && api('/api/push/settings', { endpoint: sub.endpoint, ...settings });
}

export async function testPush() {
  const sub = await currentSubscription();
  return sub && api('/api/push/test', { endpoint: sub.endpoint });
}

/** On the PC in a browser (not the app): keyboard and mouse in the page count as activity, sent at most once a minute. */
export function watchPcActivity() {
  if (window.desktop || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  let last = 0;
  const report = () => {
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    api('/api/presence', { idleMs: 0 }).catch(() => {});
  };
  ['mousemove', 'keydown', 'wheel', 'pointerdown'].forEach(type => addEventListener(type, report, { passive: true, capture: true }));
}

/** Notifications of sessions that no longer wait for anything are closed as soon as the page knows it (needed on the
 * iPhone, which gets no close push, see engine/push.mjs). */
export function closeHandledNotifications() {
  if (pushBlocker() || !('getNotifications' in ServiceWorkerRegistration.prototype)) return;
  effect(() => {
    const list = sessions();
    if (!list.length) return; // not loaded yet
    const blocked = new Set(list.filter(s => s.blocked).map(s => s.slug));
    registration().then(reg => reg.getNotifications()).then(shown => {
      for (const n of shown) if (n.data?.slug && !blocked.has(n.data.slug)) n.close();
    }).catch(() => {});
  });
}
