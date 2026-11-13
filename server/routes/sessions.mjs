// Routes about the engine or Claude Code sessions (the rest of /api/ is relayed to it as is by server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { recentFolders } from '../../driver.mjs';
import { folderHistory } from '../../projects.mjs';
import { DASH_DIR, sendJson } from '../../common.mjs';
import { engine, engineAlive } from '../engine-client.mjs';
import { isPathAllowed } from '../paths.mjs';
import { sessionConsumption, consumptionComparison } from '../consumption.mjs';
import { t } from '../../public/i18n/index.js';

export default {
  '* /api/ping': async (req, res) => sendJson(res, 200, { ok: true, engine: await engineAlive() }),
  '* /api/folders': async (req, res) => sendJson(res, 200, await recentFolders()),
  // /usage: consumption of a session (by its Claude Code id) and dashboard / terminal comparison
  'GET /api/usage/session': async (req, res, { url }) => sendJson(res, 200, await sessionConsumption(url.searchParams.get('id'))),
  'GET /api/usage/comparison': async (req, res) => sendJson(res, 200, await consumptionComparison(7)),

  // Past Claude Code sessions of a folder, with those already in the dashboard
  '* /api/history': async (req, res, { url }) => {
    const dir = url.searchParams.get('dir') || '';
    if (!dir || !fs.existsSync(dir)) return sendJson(res, 400, { error: t('server.errors.folderNotFound', { path: dir }) });
    // From the wifi or the internet: only the conversations of a known project (the PC reads any folder's)
    if (!(await isPathAllowed(path.resolve(dir), req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
    const known = await engine('/api/sessions').catch(() => []);
    const byId = new Map(known.filter(s => s.sessionId).map(s => [s.sessionId, s.slug]));
    // Conversations whose panel is archived (engine/archives.mjs, archiveSession): "Resume" restores it
    const archives = new Map();
    const archiveDir = path.join(DASH_DIR, 'sessions', 'archive');
    for (const f of fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(f => f.endsWith('.json')) : []) {
      try { const a = JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf8')); if (a.sessionId) archives.set(a.sessionId, a.title || a.slug); } catch { /* ignored */ }
    }
    return sendJson(res, 200, (await folderHistory(dir)).map(x => ({ ...x, slug: byId.get(x.sessionId) || null, archived: archives.get(x.sessionId) || null })));
  },
};
