// Branch commits, below the modified files.
import { detail } from '../../core/state.js';
import { $, esc, timeAgo, skeleton } from '../../core/dom.js';
import { readCommit, readCommits } from '../../services/git.js';
import { openViewer } from '../editor/viewer.js';
import { pathMenu } from '../path-menu.js';
import { filesHtml } from '../git-files.js';
import { t, locale } from '../../i18n/index.js';

// Commits, below the modified files: the latest of the branch; a click expands the commit (message, files), a
// click on a file opens the diff as of then (its version before the commit against the one it left).
let openCommit = null; // hash of the expanded commit
/** A commit is expanded: the commits below it are not reloaded. */
export const expandedCommit = () => !!openCommit;
const commitDetails = new Map(); // hash → detail (files), kept for the life of the page
// Loaded in pages of 20; the zone shows 5 and scrolls, the next page arrives when reaching the bottom.
const COMMITS_PAGE = 20;
let commitPages = null; // { dir, commits, end }: what is loaded for the displayed folder
let loadingCommits = false;
export async function renderCommits(d) {
  const paint = r => {
    const zone = $('#commits-zone');
    if (!zone || detail()?.slug !== d.slug) return;
    const filesOf = c => {
      const det = commitDetails.get(c.hash);
      if (!det) return skeleton('lines', 3);
      return `${det.body ? `<pre class="commit-body">${esc(det.body)}</pre>` : ''}
        ${filesHtml(det.files, `data-commit="${esc(c.hash)}"`)}`;
    };
    const scroll = zone.querySelector('.commit-list')?.scrollTop || 0;
    zone.classList.toggle('expanded', !!openCommit);
    zone.innerHTML = !r || r.notGit ? '' : `<h3 class="commits-title">${t('side.commits.title')} <span class="m">(${r.end ? t('side.commits.currentBranchCount', { n: r.commits.length }) : t('side.commits.currentBranch')})</span></h3>
      <div class="commit-list">` + (r.commits.map(c => `<div class="commit ${openCommit === c.hash ? 'open' : ''}">
          <button class="commit-row" data-hash="${esc(c.hash)}" title="${esc(c.hash)}">
            <span class="hash">${esc(c.short)}</span>
            <span class="subject">${c.unpushed ? `<span class="unpushed" title="${t('side.commits.unpushed')}">↑</span> ` : ''}${esc(c.subject)}</span>
            <span class="m when">${timeAgo(c.date)}</span>
          </button>
          ${openCommit === c.hash ? `<div class="commit-detail"><div class="m">${esc(c.author)} · ${new Date(c.date).toLocaleString(locale())}</div>${filesOf(c)}</div>` : ''}
        </div>`).join('') || `<p class="m">${t('side.commits.none')}</p>`) + (r.end ? '' : '<p class="m more-commits">…</p>') + '</div>';
    const l = zone.querySelector('.commit-list');
    if (l) {
      l.scrollTop = scroll;
      // Infinite scroll: near the bottom, the next page
      l.addEventListener('scroll', () => { if (!r.end && l.scrollHeight - l.scrollTop - l.clientHeight < 40) nextPage(); });
    }
    zone.querySelectorAll('.commit-row').forEach(b => b.addEventListener('click', async () => {
      openCommit = openCommit === b.dataset.hash ? null : b.dataset.hash;
      paint(r);
      if (openCommit && !commitDetails.has(openCommit)) {
        const h = openCommit;
        try { commitDetails.set(h, await readCommit(d.cwd, h)); } catch (e) { alert(e.message); }
        paint(r);
      }
    }));
    zone.querySelectorAll('.git-file[data-commit]').forEach(b => b.addEventListener('click', () => {
      const c = r.commits.find(x => x.hash === b.dataset.commit), det = commitDetails.get(b.dataset.commit);
      openViewer(det.files[+b.dataset.i].path, det.files.map(f => f.path), +b.dataset.i, { commit: c.hash, title: `${c.short} · ${c.subject}`, files: det.files });
    }));
    // Right click: the path menu (the file as it is on disk today)
    zone.querySelectorAll('.git-file[data-commit]').forEach(b => b.addEventListener('contextmenu', e => {
      e.preventDefault();
      pathMenu({ dataset: { path: commitDetails.get(b.dataset.commit).files[+b.dataset.i].path }, textContent: '' }, e.clientX, e.clientY);
    }));
  };
  const load = skip => readCommits(d.cwd, COMMITS_PAGE, skip);
  async function nextPage() {
    if (loadingCommits || !commitPages || commitPages.end || commitPages.dir !== d.cwd) return;
    loadingCommits = true;
    try {
      const r = await load(commitPages.commits.length);
      const seen = new Set(commitPages.commits.map(c => c.hash));
      commitPages.commits.push(...r.commits.filter(c => !seen.has(c.hash)));
      commitPages.end = r.commits.length < COMMITS_PAGE;
      paint(commitPages);
    } catch { /* we will retry on the next scroll */ }
    loadingCommits = false;
  }
  paint(commitPages?.dir === d.cwd ? commitPages : null);
  try {
    // Refresh: the first page; if the head has not moved, keep what is already loaded
    const r = await load(0);
    if (r.notGit) return paint(r);
    const head = commitPages?.dir === d.cwd && commitPages.commits[0]?.hash === r.commits[0]?.hash;
    if (head) r.commits.forEach((c, i) => Object.assign(commitPages.commits[i] || {}, c)); // "pushed" state up to date
    else commitPages = { dir: d.cwd, commits: r.commits, end: r.commits.length < COMMITS_PAGE };
    paint(commitPages);
  } catch (e) { paint({ notGit: true }); }
}
