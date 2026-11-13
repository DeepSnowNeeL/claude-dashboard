// Git routes: modified files, versions of a file, commits.
import fs from 'node:fs';
import path from 'node:path';
import { sendJson, readBody } from '../../common.mjs';
import { isPathAllowed } from '../paths.mjs';
import { gitStatus, gitCommits, gitCommit, fileVersions, revertChanges } from '../git.mjs';
import { t } from '../../public/i18n/index.js';

/** Commits of the branch ("Commits" tab): the list, or the detail of a commit. */
const commits = detail => async (req, res, { url }) => {
  const dir = path.resolve(url.searchParams.get('dir') || '');
  if (!fs.existsSync(dir) || !(await isPathAllowed(dir, req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
  try {
    const n = Math.min(Number(url.searchParams.get('n')) || 20, 100), skip = Math.max(Number(url.searchParams.get('skip')) || 0, 0);
    return sendJson(res, 200, !detail ? await gitCommits(dir, n, skip) : await gitCommit(dir, url.searchParams.get('hash') || ''));
  } catch (e) { return sendJson(res, 200, { notGit: true, error: e.message }); }
};

export default {
  // Modified files of a folder ("Modified files" tab of the right panel)
  '* /api/git/status': async (req, res, { url }) => {
    const dir = path.resolve(url.searchParams.get('dir') || '');
    if (!fs.existsSync(dir) || !(await isPathAllowed(dir, req))) return sendJson(res, 403, { error: t('server.errors.folderOutsideProjects') });
    try { return sendJson(res, 200, await gitStatus(dir)); } catch (e) { return sendJson(res, 200, { notGit: true, error: e.message }); }
  },
  // A file for the editor: its version of the last commit and its current version (diff), or only the current one
  '* /api/git/diff': async (req, res, { url }) => {
    const file = path.resolve(url.searchParams.get('file') || '');
    if (!(await isPathAllowed(file, req))) return sendJson(res, 403, { error: t('server.errors.fileOutsideProjects') });
    try { return sendJson(res, 200, await fileVersions(file, url.searchParams.get('commit') || null)); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  },
  // Brings a file back to the last commit, or deletes a new file (↶ / 🗑 buttons of the "Modified files" tab)
  'POST /api/git/revert': async (req, res) => {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
    const file = path.resolve(String(body.file || ''));
    if (!body.file || !(await isPathAllowed(file, req))) return sendJson(res, 403, { error: t('server.errors.fileOutsideProjects') });
    try { await revertChanges(file); return sendJson(res, 200, { ok: true }); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  },
  // Commit tracking: the latest of the branch, then the detail of a commit ("Commits" tab)
  '* /api/git/commits': commits(false),
  '* /api/git/commit': commits(true),
};
