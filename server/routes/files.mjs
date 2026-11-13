// Files served to the page: clickable paths of the conversation, existence of a path.
import fs from 'node:fs';
import path from 'node:path';
import { sendJson, serveFile } from '../../common.mjs';
import { isSensitive, isPathAllowed } from '../paths.mjs';
import { t } from '../../public/i18n/index.js';

export default {
  // Clickable paths of the conversation: open a file in a tab (GET /api/file/<path>, the relative links of an HTML
  // page follow), or show it in the explorer. Only under a known project.
  'GET /api/file/*': async (req, res, { p }) => {
    const file = path.resolve(decodeURIComponent(p.slice('/api/file/'.length)));
    if (!(await isPathAllowed(file, req))) { res.writeHead(403); res.end(t('server.errors.outsideDashboardProjects')); return; }
    return serveFile(res, file, { sandboxed: true });
  },
  '* /api/exists': async (req, res, { url }) => {
    const file = path.resolve(url.searchParams.get('path') || '');
    // Sensitive file: from the PC, say it exists (the menu explains why it does not open); elsewhere, nothing
    if (isSensitive(file, req)) return sendJson(res, 200, { exists: false, sensitive: !!req.fromPc && fs.existsSync(file) });
    const ok = fs.existsSync(file) && (await isPathAllowed(file, req));
    return sendJson(res, 200, { exists: ok, isDir: ok && fs.statSync(file).isDirectory() });
  },
};
