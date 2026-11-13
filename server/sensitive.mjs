// Sensitive files (credentials, keys, the dashboard's own secrets): never served, listed, opened nor copied by the
// dashboard. Shared by the page (server/paths.mjs) and the engine (mockups, archives). Tested in
// tests/sensitive.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR, WIN, norm } from '../common.mjs';

const SENSITIVE = [
  /[\\/]\.ssh([\\/]|$)/i, /[\\/]\.gnupg([\\/]|$)/i, /[\\/]\.claude[\\/]\.credentials\.json$/i,
  // acces.json: name of the file in a French install, kept in case it was not renamed
  /[\\/]\.claude-dashboard[\\/](acces|access)\.json$/i,
  /[\\/]\.env(\.[^\\/]*)?$/i, /\.(pem|key|p12|pfx|kdbx)$/i, /[\\/][^\\/]*(credential|secret|token|password)[^\\/]*$/i,
];
// `*.local` (settings specific to the machine: deployment, webhook…): opened like the others from the PC, never elsewhere
const LOCAL = /\.local$/i;

/** Name of a sensitive file, by its path alone (`fromPc`: `*.local` allowed). */
function sensitiveName(c, fromPc, dashDir) {
  return SENSITIVE.some(re => re.test(c)) || c === norm(path.join(dashDir, 'access.json'))
    || c === norm(path.join(dashDir, 'acces.json')) // French install (see above)
    || c === norm(path.join(dashDir, 'engine-token'))
    || (!fromPc && LOCAL.test(c));
}

/**
 * Sensitive file (credentials, keys; `*.local` outside the PC): never served, listed or opened by the dashboard.
 * Windows: a `:` after the drive letter (alternate stream `access.json::$DATA`) is refused, and the path is compared
 * as Windows resolves it too (an 8.3 short name such as `ACCESS~1.JSO` gives back the long name).
 */
export function isSensitive(file, req, { win = WIN, dashDir = DASH_DIR } = {}) {
  const c = norm(file);
  const fromPc = !!req?.fromPc;
  if (win && (c.slice(2).includes(':') || /^\\\\[?.]\\/.test(c))) return true; // alternate stream, or a \\?\ device path
  if (sensitiveName(c, fromPc, dashDir)) return true;
  let real = null;
  try { real = norm(fs.realpathSync.native(file)); } catch { /* does not exist (yet): its name is all there is */ }
  return !!real && real !== c && sensitiveName(real, fromPc, dashDir);
}
