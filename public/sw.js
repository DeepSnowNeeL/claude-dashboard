// PWA service worker: makes the page installable as an app on the phone, and replaces the white screen with
// public/offline.html when the PC cannot be reached (turned off, asleep, page server stopped).
// Nothing else is cached: the page only makes sense connected to the sessions.
const CACHE = 'offline-v1';
const OFFLINE = '/offline.html';
// The page has not answered after this delay: the PC is probably off (its TCP connection never opens)
const TIMEOUT = 10000;
// Answers of Caddy when the page server behind it does not answer
const UNREACHABLE = new Set([502, 503, 504]);

// The offline page, its icon and the dictionaries it imports (module graph followed from /i18n/index.js)
async function precache() {
  const cache = await caches.open(CACHE);
  const seen = new Set();
  const visit = async url => {
    if (seen.has(url)) return;
    seen.add(url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    if (url.endsWith('.js')) {
      const text = await res.clone().text();
      const imports = [...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)];
      await Promise.all(imports.map(m => visit(new URL(m[1], new URL(url, self.location.origin)).pathname)));
    }
    await cache.put(url, res);
  };
  await Promise.all([visit(OFFLINE), visit('/icon-512.png'), visit('/i18n/index.js')]);
}

self.addEventListener('install', e => e.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

async function offline() {
  return (await caches.match(OFFLINE)) || new Response('', { status: 503 });
}

// A navigation request cannot be given a RequestInit (no AbortSignal): the timeout is a race
async function navigate(req) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT); });
  try {
    const res = await Promise.race([fetch(req), late]);
    return UNREACHABLE.has(res.status) ? offline() : res;
  } catch {
    return offline();
  } finally {
    clearTimeout(timer);
  }
}

// Dictionaries: from the network (kept up to date in the cache), from the cache when the PC cannot be reached
async function networkThenCache(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(new URL(req.url).pathname, copy)).catch(() => {});
    }
    return res;
  } catch {
    return (await caches.match(new URL(req.url).pathname)) || Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') e.respondWith(navigate(req));
  else if (url.pathname.startsWith('/i18n/') || url.pathname === OFFLINE || url.pathname === '/icon-512.png') e.respondWith(networkThenCache(req));
});
