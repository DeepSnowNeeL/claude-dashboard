// PWA service worker: its only purpose is to make the page installable as an app on the phone.
// No cache: everything comes from the server (the page only makes sense connected to the sessions).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
