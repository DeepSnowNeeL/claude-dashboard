// Remote access management: from the PC only (not the wifi, not the internet; server mode: also from approved devices).
// server.mjs refuses the others before they get here, and answers 404 "not found" to any /api/access… missing from this
// table. The command line (`dash.mjs devices`) uses them too, on 127.0.0.1.
import { sendJson, readBody, SERVER_MODE } from '../../common.mjs';
import * as access from '../../access.mjs';
import { caddyAlive, caddyExe, restartCaddy } from '../caddy.mjs';
import { updateRelayListeners, closeStreams } from '../remote.mjs';
import { t } from '../../public/i18n/index.js';

const readJson = async req => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };

/**
 * An access setting: applies it, reloads Caddy, or answers 400 with the error message. `caddy`: a Caddy setting
 * (domain, relays…), refused in server mode where the user's own reverse proxy does HTTPS.
 */
const setting = (apply, caddy = true) => async (req, res, c, body) => {
  if (caddy && SERVER_MODE) return sendJson(res, 400, { error: t('server.errors.notInServerMode') });
  try {
    await apply(body ?? await readJson(req));
    return sendJson(res, 200, { ok: true });
  } catch (e) { return sendJson(res, 400, { error: e.message }); }
};

export default {
  '* /api/access': async (req, res) => sendJson(res, 200, SERVER_MODE ? { ...access.config(), devices: access.devices(), serverMode: true }
    : { ...access.config(), devices: access.devices(), caddy: await caddyAlive(), exe: !!caddyExe() }),
  // From an approved device (server mode), the current password is required: a stolen device cannot lock the owner out.
  // From the PC or the command line on it, not needed (forgotten password).
  'POST /api/access/password': async (req, res, c) => {
    const body = await readJson(req);
    if (c.external && access.config().password && !(await access.checkPassword(body.current))) return sendJson(res, 403, { error: t('access.errors.wrongCurrentPassword') });
    return setting(() => { access.setPassword(body.password); closeStreams(); }, false)(req, res, c, body);
  },
  // By the code shown on the device's waiting screen (or its id): command line `dash.mjs devices approve|revoke <code>`
  'POST /api/access/approve': async (req, res) => {
    const device = access.approveByCode((await readJson(req)).code);
    return device ? sendJson(res, 200, { ok: true, device }) : sendJson(res, 404, { error: t('server.errors.unknownDevice') });
  },
  'POST /api/access/revoke': async (req, res) => {
    const device = access.revokeByCode((await readJson(req)).code);
    if (device) closeStreams(device.id);
    return device ? sendJson(res, 200, { ok: true, device }) : sendJson(res, 404, { error: t('server.errors.unknownDevice') });
  },
  'POST /api/access/domain': setting(async body => { access.setDomain(body.domain); await restartCaddy(); }),
  // Other PCs relayed by the Caddy here; or this PC reached through another PC's relay (no more Caddy here)
  'POST /api/access/relays': setting(async body => { access.setRelays(body.relays); await restartCaddy(); }),
  'POST /api/access/via-relay': setting(async body => {
    access.setViaRelay(body.ip);
    await restartCaddy();
    updateRelayListeners();
  }),
  // Certificate validation through port 80 (PC whose HTTPS comes through another port of the box, e.g. 8443)
  'POST /api/access/http-port': setting(async body => {
    access.setHttpPort(body.httpPort);
    await restartCaddy();
  }),
  'POST /api/access/devices/:id/approve': async (req, res, { params }) => {
    if (!/^[0-9a-f]+$/.test(params.id)) return sendJson(res, 404, { error: t('server.errors.notFound') });
    return sendJson(res, access.approve(params.id) ? 200 : 404, { ok: true });
  },
  'DELETE /api/access/devices/:id': async (req, res, { params }) => {
    if (!/^[0-9a-f]+$/.test(params.id)) return sendJson(res, 404, { error: t('server.errors.notFound') });
    const revoked = access.revoke(params.id);
    if (revoked) closeStreams(params.id);
    return sendJson(res, revoked ? 200 : 404, { ok: true });
  },
};
