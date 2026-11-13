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

// Reverting a file (🗑 deletes a new one, ↶ goes back to the last commit): a 1st click arms it for a few
// seconds, the 2nd acts. The arming survives
// the 10 s repaint.
let armed = null, armedTimer = null;
function arm(path) {
  armed = path;
  clearTimeout(armedTimer);
  armedTimer = setTimeout(() => { armed = null; $('#right .git-revert.armed')?.classList.remove('armed'); }, 4000);
}
async function revert(d, path) {
  armed = null;
  clearTimeout(armedTimer);
  try { await revertFile(path); } catch (e) { alert(t('side.files.revertFailed', { message: e.message })); }
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
    const path = list[+b.dataset.i].path, del = e.target.closest('[data-cancel]');
    if (!del) return openViewer(path, list.map(f => f.path), +b.dataset.i, { files: list });
    if (armed !== path) {
      $('#right .git-revert.armed')?.classList.remove('armed');
      arm(path);
      del.classList.add('armed');
      del.title = del.textContent === '🗑' ? t('side.files.clickAgainDelete') : t('side.files.clickAgainRevert');
    } else revert(d, path);
  }));
  // Right click: the chat path menu (browser, VS Code, Windows explorer…)
  $('#right').querySelectorAll('.git-file:not([data-commit])').forEach(b => b.addEventListener('contextmenu', e => {
    e.preventDefault();
    pathMenu({ dataset: { path: list[+b.dataset.i].path }, textContent: '' }, e.clientX, e.clientY);
  }));
  if (armed) $('#right').querySelectorAll('.git-file:not([data-commit])').forEach(b => {
    if (list[+b.dataset.i]?.path === armed) b.querySelector('[data-cancel]')?.classList.add('armed');
  });
}
