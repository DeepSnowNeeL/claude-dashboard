// Right panel: "Tracker", "Modified files" and "Explorer" tabs. An effect redraws it when the displayed
// session, the tab or the git state change; the Tracker content is drawn by the function app.js passes.
import { signal, effect } from '../../core/signals.js';
import { current, detail, sideTab, gitStatus } from '../../core/state.js';
import { $ } from '../../core/dom.js';
import { write } from '../../core/storage.js';
import { readGitStatus } from '../../services/git.js';
import { renderExplorer } from '../explorer/explorer.js';
import { renderCommits, expandedCommit } from './commits.js';
import { paintFiles } from './files.js';
import { t } from '../../i18n/index.js';

const rerun = signal(0); // "redraw everything" (theme change, Tracker section marked seen)
let last = null;         // { d, tab }: what the last run of the effect drew

/** Redraws the panel for the displayed session, as if we had just arrived on it. */
export function rerenderSide() {
  last = null;
  rerun.update(n => n + 1);
}

const filesLabel = d => {
  const n = gitStatus().dir === d.cwd ? gitStatus().files.length : null;
  return `${t('side.tabs.files')}${n ? ` <span class="count">${n}</span>` : ''}`;
};

function sideTabs(d) {
  if (!d.cwd) return '';
  return `<div class="right-tabs">
    <button class="tab ${sideTab() === 'tracker' ? 'on' : ''}" data-right-tab="tracker">${t('side.tabs.tracker')}</button>
    <button class="tab ${sideTab() === 'files' ? 'on' : ''}" data-right-tab="files">${filesLabel(d)}</button>
    <button class="tab ${sideTab() === 'explorer' ? 'on' : ''}" data-right-tab="explorer" title="${t('side.tabs.explorerTitle')}">${t('side.tabs.explorer')}</button>
  </div>`;
}

// The count of the "Modified files" tab stays up to date even while looking at the tracker
let gitRead = 0;
async function countGitFiles(d) {
  if (!d.cwd || Date.now() - gitRead < 10_000 && gitStatus().dir === d.cwd) return;
  gitRead = Date.now();
  try { gitStatus.set({ dir: d.cwd, ...(await readGitStatus(d.cwd)) }); } catch { /* we will retry on the next reading */ }
}

/** Rereads the git state (the effect repaints the list) then the commits, except under an expanded commit. */
async function refreshGit(d, zoneBefore) {
  try { gitStatus.set({ dir: d.cwd, ...(await readGitStatus(d.cwd)) }); } catch (e) { gitStatus.set({ dir: d.cwd, notGit: true, files: [] }); }
  if (sideTab() !== 'files' || detail()?.slug !== d.slug) return;
  if (!expandedCommit() || !zoneBefore) renderCommits(d); // no reload under an expanded commit
}

// Git reading every 10 s, for the displayed session only: it stops when it changes
let pollSlug = null, timer = null;
function stopPolling() { clearInterval(timer); pollSlug = null; }
function followPolling(slug) {
  if (slug === pollSlug) return;
  clearInterval(timer);
  pollSlug = slug;
  timer = setInterval(() => {
    const d = detail();
    if (!d?.cwd || d.slug !== slug || d.slug !== current() || document.querySelector('.viewer') || document.hidden) return;
    if (sideTab() === 'files') refreshGit(d, $('#commits-zone')?.dataset.slug === d.slug ? $('#commits-zone') : null);
    else countGitFiles(d);
  }, 10_000);
}

/**
 * Mounts the right panel in `el`. `renderTracker(d, bar)` draws the Tracker tab (the tab bar on
 * top of what it writes in `el`).
 */
export function mountSide(el, renderTracker) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-right-tab]');
    if (!b) return;
    sideTab.set(b.dataset.rightTab);
    write('dash-side-tab', sideTab());
    rerenderSide();
  });
  const sideEffect = effect(() => {
    const d = detail(), tab = sideTab();
    gitStatus(); rerun();
    if (!d) return stopPolling();
    followPolling(d.slug);
    const changed = !last || last.d !== d || last.tab !== tab;
    last = { d, tab };
    // Only the git state changed outside the files tab: update the count, without repainting
    if (!changed && tab !== 'files') {
      const b = el.querySelector('[data-right-tab="files"]');
      if (b) b.innerHTML = filesLabel(d);
      return;
    }
    if (tab === 'files' && d.cwd) {
      const zoneBefore = $('#commits-zone')?.dataset.slug === d.slug ? $('#commits-zone') : null;
      paintFiles(d, sideTabs(d), zoneBefore);
      if (changed) refreshGit(d, zoneBefore);
      else if (!zoneBefore) renderCommits(d); // zone redone (layout change)
    } else if (tab === 'explorer' && d.cwd) renderExplorer(d, sideTabs(d));
    else {
      el.classList.remove('mode-git');
      countGitFiles(d);
      renderTracker(d, sideTabs(d));
    }
  });
  return () => { sideEffect(); stopPolling(); };
}
