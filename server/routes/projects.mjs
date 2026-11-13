// Projects, groups, session order, logos: the left tree.
import fs from 'node:fs';
import path from 'node:path';
import { pathKey, tree, projectLogo, readGroups, writeGroups, importOrca, writeProjectMeta, readOrders, writeOrder, addProject, removeProject } from '../../projects.mjs';
import { sendJson, readBody, WORKSPACE_DIR, SANDBOX_CSP } from '../../common.mjs';
import { notifyChange, engine } from '../engine-client.mjs';
import { knownProjects } from '../paths.mjs';
import { t } from '../../public/i18n/index.js';

export default {
  // Server mode: the workspace folder and its first-level subfolders (the cloned repositories), proposed by the new
  // session page. Local mode: nothing.
  'GET /api/workspace': async (req, res) => {
    if (!WORKSPACE_DIR) return sendJson(res, 200, { dir: null, folders: [] });
    let entries = [];
    try { entries = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true }); } catch { /* not mounted yet */ }
    const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(WORKSPACE_DIR, e.name), git: fs.existsSync(path.join(WORKSPACE_DIR, e.name, '.git')) }))
      .sort((a, b) => (b.git - a.git) || a.name.localeCompare(b.name));
    return sendJson(res, 200, { dir: WORKSPACE_DIR, folders });
  },
  // Logo of a project: only the one of a project known to the tree (not a free path)
  '* /api/projects/logo': async (req, res, { url }) => {
    const f = projectLogo(url.searchParams.get('id') || '');
    const m = f?.match(/^data:(image\/[\w+.-]+);base64,(.*)$/s);
    if (m) { res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'max-age=300', 'Content-Security-Policy': SANDBOX_CSP, 'X-Content-Type-Options': 'nosniff' }); res.end(Buffer.from(m[2], 'base64')); return; }
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=300', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  },

  'POST /api/import-orca': async (req, res) => {
    try { const r = await importOrca(); notifyChange(); return sendJson(res, 200, r); } catch (e) { return sendJson(res, 500, { error: t('server.projects.orcaImportFailed', { message: e.message }) }); }
  },
  // Manual order of the sessions of a worktree (drag and drop in the tree)
  '* /api/orders': async (req, res) => {
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
      if (!body.worktree) return sendJson(res, 400, { error: t('server.projects.worktreeRequired') });
      writeOrder(body.worktree, body.slugs);
      notifyChange();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 200, readOrders());
  },
  // Customisation of a project in the tree: displayed name, name colour, icon (emoji), ticket link
  'PUT /api/projects/meta': async (req, res) => {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
    if (!body.id) return sendJson(res, 400, { error: t('server.projects.idRequired') });
    writeProjectMeta(String(body.id), body);
    notifyChange();
    return sendJson(res, 200, { ok: true });
  },
  '* /api/groups': async (req, res) => {
    if (req.method === 'PUT') {
      try { writeGroups(JSON.parse(await readBody(req))); } catch (e) { return sendJson(res, 400, { error: t('server.errors.invalidJsonDetail', { message: e.message }) }); }
      notifyChange();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 200, readGroups());
  },
  '* /api/projects': async (req, res) => {
    if (req.method === 'POST' || req.method === 'DELETE') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
      const dir = String(body.path || '');
      if (req.method === 'POST' && (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())) return sendJson(res, 400, { error: t('server.errors.folderNotFound', { path: dir }) });
      if (req.method === 'DELETE') {
        // Removing a project from the tree: refused if it has open sessions; its ended sessions are archived
        // (otherwise it would come back at once), recoverable in the folder history.
        const sessions = await engine('/api/sessions').catch(() => []);
        const p = (await tree([dir])).find(x => x.worktrees.some(w => w.id === pathKey(dir)));
        const ids = (p?.worktrees || [{ id: pathKey(dir) }]).map(w => w.id);
        const inside = s => s.cwd && ids.some(id => pathKey(s.cwd) === id || pathKey(s.cwd).startsWith(id + '/'));
        const open = sessions.filter(s => inside(s) && s.status !== 'done');
        if (open.length) return sendJson(res, 409, { error: t('server.projects.sessionsOpen', { n: open.length, names: open.map(s => s.title || s.slug).join(', ') }) });
        for (const s of sessions.filter(inside)) await engine(`/api/sessions/${s.slug}/archive`, { method: 'POST' }).catch(() => {});
        removeProject(dir);
      } else addProject(dir);
      notifyChange();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 200, await knownProjects());
  },
};
