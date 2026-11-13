// git reads of a folder (page server): status, commits, versions of a file.
import { api } from '../core/api.js';
import { t } from '../i18n/index.js';

// [letter, label] per state; getters so that the label follows the language chosen after the modules are loaded
const gitState = (letter, key) => ({ enumerable: true, get: () => [letter, t(`common.git.${key}`)] });
export const GIT_STATES = Object.defineProperties({}, {
  modified: gitState('M', 'modified'), added: gitState('A', 'added'), deleted: gitState('D', 'deleted'),
  untracked: gitState('?', 'untracked'), renamed: gitState('R', 'renamed'),
});

/** git state of the folder: { notGit } or { branch, root, files }. */
export const readGitStatus = dir => api(`/api/git/status?dir=${encodeURIComponent(dir)}`);

/** Brings a file back to the last commit (a new file is deleted). */
export const revertFile = file => api('/api/git/revert', { file });

/** Commits of the current branch, `n` from `skip`. */
export const readCommits = (dir, n, skip) => api(`/api/git/commits?dir=${encodeURIComponent(dir)}&n=${n}&skip=${skip}`);

/** Full message and files of a commit. */
export const readCommit = (dir, hash) => api(`/api/git/commit?dir=${encodeURIComponent(dir)}&hash=${hash}`);

/** Versions of a file (last commit and current, or before / after a commit). */
export const readDiff = (file, commit) => api(`/api/git/diff?file=${encodeURIComponent(file)}${commit ? `&commit=${commit}` : ''}`);

/** Removes a worktree (not the main one). Returns `{ ok }` or `{ error, dirty }` (dirty: uncommitted changes). */
export const removeWorktree = (path, force = false) => fetch('/api/worktree/remove', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, force }),
}).then(r => r.json()).catch(e => ({ error: e.message }));
