// Rendering of git files (modified, or those of a commit), shared by the right panel and the viewer.
import { signal } from '../core/signals.js';
import { esc } from '../core/dom.js';
import { read } from '../core/storage.js';
import { GIT_STATES } from '../services/git.js';
import { t } from '../i18n/index.js';

// Display of the files (modified, and those of a commit): as a list or a folder tree, by choice (⋯ menu)
export const filesLayout = signal(read('dash-files-layout', 'list') || 'list');
const fileLines = f => (f.binary ? `<span class="m">${t('side.gitFiles.binary')}</span>`
  : `${f.insertions ? `<span class="plus">+${f.insertions}</span>` : ''}${f.deletions ? ` <span class="minus">−${f.deletions}</span>` : ''}`);
function fileButton(f, i, attrs, withFolder, revert) {
  const [letter, label] = GIT_STATES[f.state] || ['M', f.state];
  const base = f.rel.split('/').pop(), folder = f.rel.slice(0, -base.length), name = f.dir ? `${base}/` : base;
  // 🗑 deletes a new file, ↶ brings the others back to the last commit: a span (no button inside a button).
  // Not on a folder (nested repository, submodule): it has its own git
  const isNew = f.state === 'untracked' || f.state === 'added';
  // ↩ (staged changes with others on top) discards only those not staged: back to the version of the index
  const toIndex = !revert || !f.partial ? '' : `<span class="git-revert" data-cancel="index" title="${t('side.gitFiles.indexTitle')}">↩</span>`;
  const del = !revert || f.dir ? '' : `<span class="git-revert" data-cancel="${isNew ? 'delete' : 'head'}" title="${isNew ? t('side.gitFiles.deleteTitle') : t('side.gitFiles.revertTitle')}">${isNew ? '🗑' : '↶'}</span>`;
  return `<button class="git-file e-${esc(f.state)}" ${attrs} data-i="${i}" title="${esc(label)} · ${esc(f.rel)}">
    <span class="letter">${letter}</span><span class="name"><b>${esc(name)}</b>${withFolder ? ` <span class="m">${esc(folder)}</span>` : ''}</span>
    <span class="lines">${fileLines(f)}</span>${toIndex}${del}</button>`;
}
/**
 * Files as a list (name then folder) or as a tree: collapsible folders, chains of single-child folders
 * merged ("src/main/java/fr"), as in editors. `revert`: 🗑 / ↶ / ↩ to delete a new file (or a folder of new
 * files), go back to the last commit or to the index.
 */
export function filesHtml(files, attrs, { revert = false } = {}) {
  if (filesLayout() !== 'tree') return files.map((f, i) => fileButton(f, i, attrs, true, revert)).join('');
  const root = { dirs: new Map(), files: [], rel: '' };
  files.forEach((f, i) => {
    let n = root;
    for (const part of f.rel.split('/').slice(0, -1)) {
      if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [], rel: `${n.rel}${part}/` });
      n = n.dirs.get(part);
    }
    n.files.push([f, i]);
  });
  const all = n => [...n.files.map(([f]) => f), ...[...n.dirs.values()].flatMap(all)];
  const render = n => [...n.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, sub]) => {
    let label = name;
    while (sub.dirs.size === 1 && !sub.files.length) { const [[n2, s2]] = sub.dirs; label += `/${n2}`; sub = s2; }
    const inside = all(sub);
    // 🗑 on a folder absent from the last commit whose files are all new (not a nested repository): its path, from
    // that of one of its files. Unchanged files are not listed: the absence from the last commit is read by the server
    const isNew = revert && inside.every(f => !f.dir && (f.state === 'untracked' || f.state === 'added'))
      && !!inside[0].newDir && sub.rel.startsWith(inside[0].newDir);
    const del = !isNew ? '' : `<span class="git-revert" data-cancel="folder" data-path="${esc(inside[0].path.slice(0, -inside[0].rel.length) + sub.rel.slice(0, -1))}" title="${t('side.gitFiles.deleteFolderTitle')}">🗑</span>`;
    return `<details class="git-folder" open><summary><span class="ic-folder">▾</span> ${esc(label)} <span class="m">${inside.length}</span>${del}</summary>
      <div class="folder-content">${render(sub)}</div></details>`;
  }).join('') + n.files.map(([f, i]) => fileButton(f, i, attrs, false, revert)).join('');
  return `<div class="git-tree">${render(root)}</div>`;
}
