// Remote access (internet, behind Caddy): settings and devices, from the PC only.
import { api } from '../core/api.js';
import { t } from '../i18n/index.js';

let state = null;
/** Last state read (null outside the PC: wifi, internet). */
export const accessState = () => state;

/** Reads the state again; null if the page is not allowed (wifi: no management). */
export async function readAccess() {
  try { state = await api('/api/access'); } catch { state = null; }
  return state;
}

export const approveDevice = id => api(`/api/access/devices/${id}/approve`, {});
export const revokeDevice = id => fetch(`/api/access/devices/${id}`, { method: 'DELETE' });
export const logOut = () => fetch('/access/logout', { method: 'POST' });

/**
 * Saves the entered settings (throws a readable error if the passwords differ or if a call fails).
 * `domain` is the domain already saved, so that Caddy is restarted only if it changes.
 */
export async function saveAccess({ pwd, pwd2, current, dom, relays, via, port80 }) {
  const { domain } = state;
  if (pwd || pwd2) {
    if (pwd !== pwd2) throw new Error(t('options.access.passwordsDiffer'));
    await api('/api/access/password', { password: pwd, current });
  }
  if (state.serverMode) return; // server mode: no domain, Caddy or relay (the reverse proxy is the user's)
  if (dom !== domain || pwd) await api('/api/access/domain', { domain: dom }); // restarts Caddy
  if (JSON.stringify(relays) !== JSON.stringify(state.relays || [])) await api('/api/access/relays', { relays });
  if (via !== (state.viaRelay || '')) await api('/api/access/via-relay', { ip: via });
  if (port80 !== (state.httpPort === 80)) await api('/api/access/http-port', { httpPort: port80 ? 80 : null });
}
