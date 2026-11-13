// Explorer: all the files of the session folder, and text search in them.
import fs from 'node:fs';
import path from 'node:path';
import { sendJson, norm } from '../../common.mjs';
import { isPathAllowed } from '../paths.mjs';
import { ignoredByGit } from '../git.mjs';
import { watch, folderFiles, searchText } from '../explorer.mjs';
import { t } from '../../public/i18n/index.js';

/** List of the files of the folder, or text search in it (same access check). */
const filesOrSearch = search => async (req, res, { url }) => {
  const dir = path.resolve(url.searchParams.get('dir') || '');
  if (!fs.existsSync(dir) || !(await isPathAllowed(dir, req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
  const start = Date.now();
  // Ctrl+P list (git, without what it ignores); the tree is read from the disk (/api/browse/list)
  if (!search) return sendJson(res, 200, { root: dir, files: await folderFiles(dir), ms: Date.now() - start });
  const q = url.searchParams.get('q') || '';
  if (q.length < 2) return sendJson(res, 200, { results: [], ms: 0 });
  // The page closes the request (new keystroke, panel closed): the search stops
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  const r = await searchText(dir, q, { regex: url.searchParams.get('regex') === '1', matchCase: url.searchParams.get('case') === '1', signal: gone.signal });
  return sendJson(res, 200, { root: dir, ...r, ms: Date.now() - start });
};

export default {
  // Content of a folder ignored by git (git does not list it): one level, read from the disk, on demand
  '* /api/browse/list': async (req, res, { url }) => {
    const dir = path.resolve(url.searchParams.get('dir') || '');
    const rel = (url.searchParams.get('rel') || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const target = path.resolve(dir, rel);
    if (!norm(target).startsWith(norm(dir)) || !fs.existsSync(target) || !(await isPathAllowed(target, req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true }).filter(e => !(e.name === '.git' && !rel)).slice(0, 5000)
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
      // In an ignored folder, everything is; otherwise git says which ones are
      const ignored = url.searchParams.get('ignore') === '1' ? new Set(entries.map(e => e.name))
        : await ignoredByGit(dir, entries.map(e => (rel ? `${rel}/` : '') + e.name + (e.isDir ? '/' : '')));
      return sendJson(res, 200, { entries: entries.map(e => ({ ...e, ignored: ignored.has(e.name) })) });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  },
  // Changes of the folder reported by Windows (fs.watch): SSE stream, the page reads the touched folders again
  '* /api/browse/watch': async (req, res, { url }) => {
    const dir = path.resolve(url.searchParams.get('dir') || '');
    if (!fs.existsSync(dir) || !(await isPathAllowed(dir, req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
    return watch(dir, req, res);
  },
  '* /api/browse/files': filesOrSearch(false),
  '* /api/browse/search': filesOrSearch(true),
};
