// Checks done on every request before any route: protection against requests forged by another website open in the
// browser (CSRF) and against DNS rebinding (a foreign domain resolved to 127.0.0.1). Pure functions, tested in
// tests/request-guard.test.mjs.

/** Lower-cased host name and port of a Host header (`localhost:4747`, `[::1]:4747`, `example.com`). */
export function splitHost(host) {
  const h = String(host || '').trim().toLowerCase();
  const m = h.match(/^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d+))?$/);
  return m ? { name: m[1], port: m[2] ? Number(m[2]) : null } : null;
}

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/;

/**
 * Host header accepted on a local listener: a loopback name (or one of `names`) with the port of the listener;
 * `ipLiterals` (local network mode): any IP address, a DNS rebinding always comes with a domain name; `anyPort` names
 * (DASH_HOSTS) match whatever the port. A rebinding attacker's domain is none of them.
 */
export function hostAllowed(host, { port, names = [], anyPort = [], ipLiterals = false }) {
  const h = splitHost(host);
  if (!h) return false;
  if (anyPort.map(x => String(x).toLowerCase()).includes(h.name)) return true;
  if (h.port !== port) return false;
  return [...LOOPBACK_NAMES, ...names.map(x => String(x).toLowerCase())].includes(h.name) || (ipLiterals && IP_LITERAL.test(h.name));
}

/** Method that changes nothing (the routes reached by GET or HEAD only read). */
export const safeMethod = method => method === 'GET' || method === 'HEAD';

/**
 * Error key (`origin`, `contentType`, `crossSite`) for a request that could come from another website, or null.
 * - Every request of a browser carries `Sec-Fetch-Site`: `cross-site` is refused on the API (an `<img>` pointing to a
 *   GET route that resumes a session, for example), except the file routes: a mockup shown in a sandbox has an opaque
 *   origin, its own resources (styles, images) arrive as cross-site.
 * - A request that changes something: its `Origin`, if any, must be the page itself (`http(s)://<Host>`); without
 *   Origin (command line, curl, the Electron main process), only from this machine (`loopback`).
 * - A body must be JSON (`Content-Type: application/json`) or carry `x-dash: 1` (raw file of an upload): a form or a
 *   no-cors fetch of another site can set neither without a preflight the page never answers.
 */
export function requestError({ method, path = '', headers = {}, loopback }) {
  if (headers['sec-fetch-site'] === 'cross-site' && path.startsWith('/api/') && !path.startsWith('/api/file/') && safeMethod(method)) return 'crossSite';
  if (safeMethod(method)) return null;
  const origin = headers.origin;
  if (origin !== undefined) {
    if (origin !== `http://${headers.host}` && origin !== `https://${headers.host}`) return 'origin';
  } else if (!loopback) return 'origin';
  const hasBody = Number(headers['content-length'] || 0) > 0 || headers['transfer-encoding'] !== undefined;
  if (hasBody && !/^application\/json\b/i.test(String(headers['content-type'] || '')) && headers['x-dash'] !== '1') return 'contentType';
  return null;
}
