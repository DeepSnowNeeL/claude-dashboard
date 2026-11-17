// Card of a session launched by this one (launch_session) in the feed: purple like the messages between sessions,
// live (status, step, blocked, unread, as its row in the tree), where it runs; a click opens it.
import { esc, timeAgo, displayName, ticketTag, statusPills, modelPill } from '../../core/dom.js';
import { effect } from '../../core/signals.js';
import { sessions, projects, current } from '../../core/state.js';
import { pathKey } from '../../services/projects.js';
import { t } from '../../i18n/index.js';

/** Worktree (with its project) holding a folder: the most precise one. */
function worktreeOf(cwd) {
  const c = pathKey(cwd);
  return c && projects().flatMap(p => p.worktrees.map(w => ({ ...w, project: p })))
    .filter(w => c === w.id || c.startsWith(w.id + '/')).sort((a, b) => b.id.length - a.id.length)[0];
}

/** Where the launched session runs, seen from its parent (`ev.from`): same folder, a branch of the project, another project. */
function where(s, ev) {
  if (!s.cwd) return '';
  if (pathKey(s.cwd) === pathKey(ev.from)) return `<span>📁 ${t('cards.launched.sameFolder')}</span>`;
  const w = worktreeOf(s.cwd), mine = worktreeOf(ev.from);
  const isNew = ev.newWorktree ? ` <span class="new">${t('cards.launched.newWorktree')}</span>` : '';
  const branch = w?.branch ? `⎇ ${esc(w.branch)}${isNew}` : '';
  if (w && mine && w.project.id === mine.project.id) return `<span>${branch || `📁 ${esc(s.cwd)}`}</span>`;
  const name = w?.project.name || s.cwd.split(/[\\/]/).filter(Boolean).pop();
  return `<span>📦 ${t('cards.launched.otherProject', { name: esc(name) })}</span>${branch && (ev.newWorktree || !w.main) ? `<span>${branch}</span>` : ''}`;
}

export function launchedCard(ev) {
  const s = sessions().find(x => x.slug === ev.slug);
  // Archived (or removed): the card stays, greyed, without a link
  if (!s) return `<div class="card launched gone"><div class="launched-head">🚀 ${t('cards.launched.title')} <b>${esc(ev.slug)}</b></div><div class="m">${t('cards.launched.gone')}</div></div>`;
  const unread = s.slug !== current() && s.unread;
  return `<a class="card launched ${s.blocked ? 'e-blocked' : s.status === 'done' ? 'e-done' : ''} ${unread ? 'unread' : ''}" href="#${esc(s.slug)}"${unread ? ` data-n="${unread > 99 ? '99+' : unread}"` : ''}>
    <div class="launched-head">🚀 ${t('cards.launched.title')} <b>${displayName(s)}</b></div>
    ${ticketTag(s)}
    ${s.description ? `<div class="d">${esc(s.description)}</div>` : ''}
    <div class="pills">${statusPills(s)} <span class="m">${timeAgo(s.updatedAt)}</span></div>
    <div class="where">${where(s, ev)}${s.model ? modelPill(s.model) : ''}</div>
    <div class="open">${t('cards.launched.open')}</div>
  </a>`;
}

/** Fills the feed element `el` with the card of `ev`; mountLaunchedCards keeps it up to date. */
export function fillLaunched(el, ev) {
  el.className = 'msg claude';
  el.dataset.launched = ev.slug;
  el._ev = ev;
  el.innerHTML = launchedCard(ev);
}

/** The cards follow the list of sessions (status, step, unread…) without a feed event. */
export function mountLaunchedCards() {
  effect(() => {
    sessions(); projects(); current();
    document.querySelectorAll('[data-launched]').forEach(el => { if (el._ev) el.innerHTML = launchedCard(el._ev); });
  });
}
