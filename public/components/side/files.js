// "Modified files" tab of the right panel: the git state of the session folder.
import { detail, sideTab, gitStatus } from '../../core/state.js';
import { $, esc, skeleton } from '../../core/dom.js';
import { write } from '../../core/storage.js';
import { readGitStatus, revertFile } from '../../services/git.js';
import { openViewer } from '../editor/viewer.js';
import { pathMenu } from '../path-menu.js';
import { filesLayout, filesHtml } from '../git-files.js';
import { t } from '../../i18n/index.js';

function layoutMenu() {
  return `<span class="layout-menu">
    <button class="plus menu" data-layout-menu title="${t('side.files.layoutTitle')}">⋯</button>
    <span class="layout-choice" hidden>
      <button data-layout="list" class="${filesLayout() === 'list' ? 'on' : ''}">${t('side.files.list')}</button>
      <button data-layout="tree" class="${filesLayout() === 'tree' ? 'on' : ''}">${t('side.files.tree')}</button>
    </span></span>`;
}

// Reverting a file (🗑 deletes a new one or a folder of new ones, ↶ goes back to the last commit, ↩ to the
// index): a 1st click arms it for a few seconds, the 2nd acts. The arming (key: kind and path) survives the 10 s
// repaint.
let armed = null, armedTimer = null;
const CLICK_AGAIN = { delete: 'clickAgainDelete', head: 'clickAgainRevert', index: 'clickAgainIndex', folder: 'clickAgainFolder' };
async function revertClick(d, span, path) {
  const kind = span.dataset.cancel, key = `${kind}:${path}`;
  if (armed !== key) {
    $('#right .git-revert.armed')?.classList.remove('armed');
    armed = key;
    clearTimeout(armedTimer);
    armedTimer = setTimeout(() => { armed = null; $('#right .git-revert.armed')?.classList.remove('armed'); }, 4000);
    span.classList.add('armed');
    span.title = t(`side.files.${CLICK_AGAIN[kind]}`);
    return;
  }
  armed = null;
  clearTimeout(armedTimer);
  try { await revertFile(path, kind); } catch (e) { alert(t('side.files.revertFailed', { message: e.message })); }
  try { gitStatus.set({ dir: d.cwd, ...(await readGitStatus(d.cwd)) }); } catch { /* next reading */ }
}

/**
 * Paints the tab for session `d` (tab bar `bar` on top). `commitsZone`: the commits zone already
 * rendered for this session, kept as is from one repaint to the next (expanded commit); otherwise a new one.
 * Reads `gitStatus`, `sideTab`, `detail` and the layout mode: called inside the effect of `mountSide`, it
 * repaints when one of them changes.
 */
export function paintFiles(d, bar, commitsZone) {
  if (sideTab() !== 'files' || detail()?.slug !== d.slug) return;
  const s = gitStatus().dir === d.cwd ? gitStatus() : null;
  const list = s?.files || [];
  $('#right').classList.add('mode-git'); // files on top (scrolling), commits fixed at the bottom
  // The 10 s repaint keeps the positions: the commits zone, taken out of the document during the repaint, loses
  // its own
  const scroll = $('#right .git-top')?.scrollTop || 0;
  const commitsScroll = commitsZone?.querySelector('.commit-list')?.scrollTop || 0;
  $('#right').innerHTML = bar + '<div class="git-top">' + (!s ? skeleton('lines', 5)
    : s.notGit ? `<p class="m">${t('side.files.notGit')}</p>`
    : `<div class="git-head"><span class="m">⎇ ${esc(s.branch || '?')} · ${esc(s.root)} · ${t('side.files.summary', { n: list.length })}</span>${layoutMenu()}</div>
      ${list.length ? filesHtml(list, '', { revert: true }) : `<p class="m">${t('side.files.nothing')}</p>`}`) + '</div>';
  // The commits follow, below the list; their zone is kept as is from one repaint to the next (expanded commit)
  const zone = commitsZone || Object.assign(document.createElement('div'), { id: 'commits-zone' });
  zone.dataset.slug = d.slug;
  $('#right').append(zone);
  $('#right .git-top').scrollTop = scroll;
  const commitList = zone.querySelector('.commit-list');
  if (commitList) commitList.scrollTop = commitsScroll;
  // ⋯ menu: list or tree, for the modified files as for those of the commits
  $('#right').querySelector('[data-layout-menu]')?.addEventListener('click', e => { e.currentTarget.nextElementSibling.hidden ^= true; });
  $('#right').querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => {
    $('#commits-zone')?.remove(); // the commits are redrawn too in the new layout
    write('dash-files-layout', b.dataset.layout);
    filesLayout.set(b.dataset.layout);
  }));
  $('#right').querySelectorAll('.git-file:not([data-commit])').forEach(b => b.addEventListener('click', e => {
    const f = list[+b.dataset.i], path = f.path, del = e.target.closest('[data-cancel]');
    // A folder (nested repository, submodule) does not open in the editor: the path menu (explorer…) instead
    if (f.dir) return pathMenu({ dataset: { path }, textContent: '' }, e.clientX, e.clientY);
    const files = list.filter(x => !x.dir);
    if (!del) return openViewer(path, files.map(x => x.path), files.indexOf(f), { files });
    revertClick(d, del, path);
  }));
  // 🗑 of a folder of new files (tree layout): in its summary, without folding it
  $('#right').querySelectorAll('.git-folder > summary [data-cancel="folder"]').forEach(s => s.addEventListener('click', e => {
    e.preventDefault();
    revertClick(d, s, s.dataset.path);
  }));
  // Right click: the chat path menu (browser, VS Code, Windows explorer…)
  $('#right').querySelectorAll('.git-file:not([data-commit])').forEach(b => b.addEventListener('contextmenu', e => {
    e.preventDefault();
    pathMenu({ dataset: { path: list[+b.dataset.i].path }, textContent: '' }, e.clientX, e.clientY);
  }));
  if (armed) $('#right').querySelectorAll('.git-top [data-cancel]').forEach(s => {
    const path = s.dataset.path || list[+s.closest('.git-file')?.dataset.i]?.path;
    if (`${s.dataset.cancel}:${path}` === armed) s.classList.add('armed');
  });
}
