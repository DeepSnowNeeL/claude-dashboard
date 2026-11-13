// Signed file links for the internet gate. An HTML page (or SVG) is served in a sandbox (SANDBOX_CSP): its origin is
// opaque, so the browser treats its images, CSS and scripts as cross-site requests and leaves the SameSite login
// cookie out. Such a page is therefore opened under a prefix carrying a read token, `/api/file/~<token>/<path>` or
// `/f/~<token>/<slug>/<path>`: its relative links keep the prefix and load without the cookie.
// A token is tied to an approved device (signed with the hash of its cookie: revoking the device or changing the
// password voids it) and to one allowed root (the project worktree of the page), and expires.
import crypto from 'node:crypto';
import * as access from '../access.mjs';
import { norm } from '../common.mjs';
import { rootOf } from './paths.mjs';

const LIFETIME_MS = 12 * 3600_000;
const TOKENED = /^\/(api\/file|f)\/~([A-Za-z0-9_-]+\.[a-z0-9]+\.[A-Za-z0-9_-]+)\/(.+)$/;

const sign = (device, expiry, root) =>
  crypto.createHmac('sha256', device.token).update(`${device.id}.${expiry}.${norm(root)}`).digest('base64url').slice(0, 32);

/** File requested by an untokened file route (`/api/file/<path>`, `/f/<slug>/<path>`), or null for another path. */
export function requestedFile(p) {
  const m = p.match(/^\/api\/file\/(.+)$/) || p.match(/^\/f\/[a-z0-9-]+\/(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** Path `p` with a token of `device` for the root of `file` inserted after the route prefix, or null outside the roots. */
export async function tokenedPath(p, file, device) {
  const root = await rootOf(file);
  if (!root) return null;
  const expiry = (Date.now() + LIFETIME_MS).toString(36);
  const prefix = p.startsWith('/f/') ? '/f/' : '/api/file/';
  return `${prefix}~${device.id}.${expiry}.${sign(device, expiry, root)}/${p.slice(prefix.length)}`;
}

/**
 * Tokened path `p`: `{ path }` without the token if it is valid for the requested file, `{ path, valid: false }`
 * otherwise (the request then goes on as an untokened one), null for any other path.
 */
export async function untoken(p) {
  const m = p.match(TOKENED);
  if (!m) return null;
  const path = `/${m[1]}/${m[3]}`;
  const [id, expiry, sig] = m[2].split('.');
  const device = access.approvedDevice(id);
  const file = requestedFile(path);
  if (!device || !file || parseInt(expiry, 36) < Date.now()) return { path, valid: false };
  const root = await rootOf(file);
  const expected = root && sign(device, expiry, root);
  const valid = !!expected && expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  return { path, valid };
}
