// Installation settings visible from the page: local network, interface language.
import fs from 'node:fs';
import path from 'node:path';
import { engineHeaders } from '../engine-client.mjs';
import { PAGE_PORT, ENGINE_PORT, DASH_DIR, LANGUAGE_SETTINGS, SERVER_MODE, sendJson, readBody, languageSetting, applyLanguage } from '../../common.mjs';
import { LAN, lanAddresses } from '../network.mjs';
import { t } from '../../public/i18n/index.js';

const OPTIONS_FILE = path.join(DASH_DIR, 'options.json');

export default {
  '* /api/network': async (req, res) => sendJson(res, 200, { lan: LAN, addresses: LAN ? lanAddresses().map(a => `http://${a}:${PAGE_PORT}`) : [] }),
  // Language setting (auto, fr, en) and server mode: read by the page and the login page, from everywhere (it reveals nothing)
  'GET /api/language': async (req, res) => sendJson(res, 200, { setting: languageSetting(), serverMode: SERVER_MODE }),
  // Saving the options (PC only, server.mjs refuses the others): the language is written here, the rest of the options
  // belong to the engine, which reads the file again before writing it (the language is kept)
  'POST /api/options': async (req, res) => {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: t('server.errors.invalidJson') });
    if ('language' in body) {
      if (!LANGUAGE_SETTINGS.includes(body.language)) return sendJson(res, 400, { error: t('server.errors.invalidLanguage') });
      let options = {};
      try { options = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')); } catch { /* no file yet */ }
      options.language = body.language;
      fs.mkdirSync(path.dirname(OPTIONS_FILE), { recursive: true });
      fs.writeFileSync(OPTIONS_FILE, JSON.stringify(options, null, 2));
      applyLanguage();
    }
    let r;
    try {
      r = await fetch(`http://127.0.0.1:${ENGINE_PORT}/api/options`, { method: 'POST', headers: engineHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    } catch (e) { return sendJson(res, 502, { error: t('server.errors.engineUnreachable', { message: e.message }) }); }
    const options = await r.json().catch(() => ({}));
    applyLanguage();
    return sendJson(res, r.status, r.ok ? { ...options, language: languageSetting() } : options);
  },
};
