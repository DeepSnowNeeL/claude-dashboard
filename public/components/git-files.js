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
  const name = f.rel.split('/').pop(), folder = f.rel.slice(0, -name.length);
  // 🗑 deletes a new file, ↶ brings the others back to the last commit: a span (no button inside a button)
  const isNew = f.state === 'untracked' || f.state === 'added';
  const del = !revert ? '' : `<span class="git-revert" data-cancel title="${isNew ? t('side.gitFiles.deleteTitle') : t('side.gitFiles.revertTitle')}">${isNew ? '🗑' : '↶'}</span>`;
  return `<button class="git-file e-${esc(f.state)}" ${attrs} data-i="${i}" title="${esc(label)} · ${esc(f.rel)}">
    <span class="letter">${letter}</span><span class="name"><b>${esc(name)}</b>${withFolder ? ` <span class="m">${esc(folder)}</span>` : ''}</span>
    <span class="lines">${fileLines(f)}</span>${del}</button>`;
}
/**
 * Files as a list (name then folder) or as a tree: collapsible folders, chains of single-child folders
 * merged ("src/main/java/fr"), as in editors. `revert`: 🗑 / ↶ to delete a
 * new file or go back to the last commit.
 */
export function filesHtml(files, attrs, { revert = false } = {}) {
  if (filesLayout() !== 'tree') return files.map((f, i) => fileButton(f, i, attrs, true, revert)).join('');
  const root = { dirs: new Map(), files: [] };
  files.forEach((f, i) => {
    let n = root;
    for (const part of f.rel.split('/').slice(0, -1)) {
      if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [] });
      n = n.dirs.get(part);
    }
    n.files.push([f, i]);
  });
  const total = n => n.files.length + [...n.dirs.values()].reduce((s, x) => s + total(x), 0);
  const render = n => [...n.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, sub]) => {
    let label = name;
    while (sub.dirs.size === 1 && !sub.files.length) { const [[n2, s2]] = sub.dirs; label += `/${n2}`; sub = s2; }
    return `<details class="git-folder" open><summary><span class="ic-folder">▾</span> ${esc(label)} <span class="m">${total(sub)}</span></summary>
      <div class="folder-content">${render(sub)}</div></details>`;
  }).join('') + n.files.map(([f, i]) => fileButton(f, i, attrs, false, revert)).join('');
  return `<div class="git-tree">${render(root)}</div>`;
}
