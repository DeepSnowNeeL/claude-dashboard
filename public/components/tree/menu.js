// Right click in the tree: menu of a session, a worktree or a project (same box as the path menu,
// which closes it on a click elsewhere or Escape).
import { sessions, projects, categories, serverMode } from '../../core/state.js';
import { esc, ticketLink } from '../../core/dom.js';
import { end, reload, archive, rename } from '../../services/sessions.js';
import { showInExplorer } from '../../services/desktop.js';
import { removeWorktree } from '../../services/git.js';
import { loadList, removeProject, pathKey, saveCategories } from '../../services/projects.js';
import { t } from '../../i18n/index.js';
import { ask } from './modal.js';
import { categoryDialog, manageCategories } from './category.js';

const copy = text => navigator.clipboard?.writeText(text);
const explore = path => (window.desktop ? window.desktop.showInExplorer(path) : showInExplorer(path).catch(e => alert(e.message)));
const newSession = path => { location.hash = `new?cwd=${encodeURIComponent(path)}`; };

/**
 * Opens the menu: `entries` = [{ ic, label, run, danger }] or '-' (separator). An entry with `sub(el)` instead of
 * `run` opens a submenu beside it (hover or click), which `sub` fills; it stays inside the menu, so a click there
 * does not close it.
 */
export function openMenu(title, entries, x, y) {
  document.querySelector('.path-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'path-menu tree-menu';
  const active = entries.filter(Boolean);
  m.innerHTML = `<div class="m">${esc(title)}</div>` + active.map((e, i) => e === '-' ? '<hr>'
    : `<button data-i="${i}" class="${e.danger ? 'danger' : ''} ${e.sub ? 'has-sub' : ''}"><span class="ic">${e.ic}</span>${esc(e.label)}</button>`).join('');
  document.body.append(m);
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8))}px`;
  const openSub = b => {
    if (b.classList.contains('hl')) return;
    closeSub();
    b.classList.add('hl');
    const s = document.createElement('div');
    s.className = 'path-menu sub-menu';
    m.append(s);
    active[b.dataset.i].sub(s);
    // On the right of the menu, on its left if there is no room; level with the entry, inside the window
    const r = m.getBoundingClientRect();
    s.style.left = r.right + s.offsetWidth + 4 > innerWidth ? `${-s.offsetWidth + 2}px` : `${r.width - 2}px`;
    s.style.top = `${Math.max(8 - r.top, Math.min(b.offsetTop - 6, innerHeight - r.top - s.offsetHeight - 8))}px`;
  };
  const closeSub = () => { m.querySelector(':scope > .sub-menu')?.remove(); m.querySelector(':scope > button.hl')?.classList.remove('hl'); };
  m.addEventListener('mouseover', e => {
    const b = e.target.closest('button[data-i]');
    if (!b || b.parentElement !== m) return;
    if (active[b.dataset.i].sub) openSub(b); else closeSub();
  });
  m.addEventListener('click', async e => {
    const b = e.target.closest('button[data-i]');
    if (!b || b.parentElement !== m) return;
    if (active[b.dataset.i].sub) { openSub(b); return; }
    m.remove();
    try { await active[b.dataset.i].run(); } catch (err) { alert(err.message); }
  });
}

/** Category submenu of a session: a click ticks or unticks (the menu stays open), then create and manage. */
function categorySub(s) {
  return el => {
    const draw = () => {
      const c = categories(), mine = c.sessions[s.slug] || [];
      el.innerHTML = c.list.map(x => `<button data-cat="${esc(x.id)}"><span class="chk">${mine.includes(x.id) ? '✓' : ''}</span><span class="sw" style="--c:${esc(x.color)}"></span>${esc(x.name)}${x.compact ? `<span class="min">${t('tree.categories.compactTag')}</span>` : ''}</button>`).join('')
        + (c.list.length ? '<hr>' : '')
        + `<button data-act="new"><span class="ic">＋</span>${t('tree.categories.newEllipsis')}</button>`
        + (c.list.length ? `<button data-act="manage"><span class="ic">⚙</span>${t('tree.categories.manageEllipsis')}</button>` : '');
    };
    const assign = async (id, on) => {
      const c = categories(), mine = (c.sessions[s.slug] || []).filter(x => x !== id);
      await saveCategories({ ...c, sessions: { ...c.sessions, [s.slug]: on ? [...mine, id] : mine } });
    };
    el.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.cat) {
        const on = !(categories().sessions[s.slug] || []).includes(b.dataset.cat);
        try { await assign(b.dataset.cat, on); } catch (err) { alert(err.message); }
        draw();
        return;
      }
      document.querySelector('.path-menu')?.remove();
      if (b.dataset.act === 'new') categoryDialog(null, { onCreated: id => assign(id, true) });
      else manageCategories();
    });
    draw();
  };
}

function sessionMenu(s, x, y) {
  const finished = s.status === 'done';
  const parent = s.parent && sessions().find(p => p.slug === s.parent);
  const ticket = ticketLink(s);
  openMenu(`${s.ticket ? `${s.ticket} · ` : ''}${s.title || s.slug}`, [
    { ic: '💬', label: t('tree.menu.open'), run: () => { location.hash = s.slug; } },
    parent && { ic: '↖', label: t('tree.menu.openParent', { name: parent.title || parent.slug }), run: () => { location.hash = parent.slug; } },
    ticket && { ic: '🎫', label: t('tree.menu.openTicket', { ticket: s.ticket }), run: () => window.open(ticket, '_blank', 'noopener') },
    s.driven && { ic: '✎', label: t('tree.menu.rename'), run: async () => {
      const title = await ask({ title: t('tree.menu.renameTitle'), label: t('tree.menu.renameLabel'), value: s.title || '' });
      if (title) { await rename(s.slug, title); await loadList(); }
    } },
    { ic: '🏷️', label: t('tree.categories.menu'), sub: categorySub(s) },
    s.cwd && { ic: '＋', label: t('tree.menu.newSessionInFolder'), run: () => newSession(s.cwd) },
    '-',
    s.cwd && !serverMode() && { ic: '📂', label: t('tree.menu.showFolderInExplorer'), run: () => explore(s.cwd) },
    s.cwd && { ic: '⧉', label: t('tree.menu.copyFolderPath'), run: () => copy(s.cwd) },
    s.sessionId && { ic: '⧉', label: t('tree.menu.copyResumeCommand'), run: () => copy(`claude -r ${s.sessionId}`) },
    { ic: '⧉', label: t('tree.menu.copyLink'), run: () => copy(`${location.origin}/#${s.slug}`) },
    s.driven && '-',
    s.driven && !finished && { ic: '⏹', label: t('tree.menu.end'), run: async () => { if (confirm(t('tree.menu.endConfirm'))) { await end(s.slug); await loadList(); } } },
    s.driven && { ic: '🔄', label: t('tree.menu.reload'), run: async () => {
      if ((s.busy || s.runningAgents || s.runningShells) && !confirm(t('conversation.header.confirmReload'))) return;
      await reload(s.slug); await loadList();
    } },
    s.driven && { ic: '🗄', label: t('tree.menu.archive'), run: async () => { if (confirm(t('tree.menu.archiveConfirm'))) { await archive(s.slug); await loadList(); } } },
  ], x, y);
}

/** Entries of a worktree (also in the menu of a project with a single worktree). */
function worktreeEntries(w, main) {
  const sess = sessions().filter(s => s.cwd && pathKey(s.cwd).startsWith(pathKey(w.path)));
  return [
    { ic: '＋', label: t('tree.menu.newSessionHere'), run: () => newSession(w.path) },
    !serverMode() && { ic: '📂', label: t('tree.menu.showInExplorer'), run: () => explore(w.path) },
    { ic: '⧉', label: t('tree.menu.copyPath'), run: () => copy(w.path) },
    w.branch && { ic: '⎇', label: t('tree.menu.copyBranch', { branch: w.branch }), run: () => copy(w.branch) },
    !main && '-',
    !main && { ic: '🗑', label: t('tree.menu.removeWorktree'), danger: true, run: async () => {
      const open = sess.filter(s => s.status !== 'done');
      if (open.length) return alert(t('tree.menu.worktreeHasSessions', { n: open.length }));
      if (!confirm(t('tree.menu.removeWorktreeConfirm', { path: w.path, branch: w.branch || '' }))) return;
      let r = await removeWorktree(w.path);
      if (r.dirty && confirm(t('tree.menu.removeWorktreeDirty'))) r = await removeWorktree(w.path, true);
      if (r.error && !r.dirty) alert(r.error);
      await loadList();
    } },
  ];
}

function worktreeMenu(path, x, y) {
  const p = projects().find(pr => pr.worktrees.some(w => pathKey(w.path) === pathKey(path)));
  const w = p?.worktrees.find(x => pathKey(x.path) === pathKey(path));
  if (!w) return;
  openMenu(`⎇ ${w.branch || path}`, worktreeEntries(w, w.main), x, y);
}

function projectMenu(n, x, y) {
  const p = projects().find(x => x.id === n.dataset.project);
  if (!p) return;
  const main = p.worktrees.find(w => w.main) || p.worktrees[0];
  openMenu(p.name, [
    ...(p.worktrees.length === 1 ? worktreeEntries(main, true) : [
      { ic: '＋', label: t('tree.menu.newSessionMain'), run: () => newSession(main.path) },
      !serverMode() && { ic: '📂', label: t('tree.menu.showInExplorer'), run: () => explore(p.path) },
      { ic: '⧉', label: t('tree.menu.copyPath'), run: () => copy(p.path) },
    ]),
    '-',
    { ic: '⋯', label: t('tree.menu.editProject'), run: () => n.querySelector('[data-edit-project]')?.click() },
    { ic: '✕', label: t('tree.menu.removeFromTree'), danger: true, run: async () => {
      if (!confirm(t('tree.removeProjectConfirm', { name: p.name }))) return;
      await removeProject(p.path);
      await loadList();
    } },
  ], x, y);
}

/** Right click in the left list: the menu of the targeted element, instead of the browser's. */
export function mountTreeMenu(el) {
  el.addEventListener('contextmenu', e => {
    const a = e.target.closest('a.sess');
    const wt = e.target.closest('[data-wt-path]');
    const np = e.target.closest('.np[data-project]');
    if (!a && !wt && !np) return;
    e.preventDefault();
    if (a) {
      const s = sessions().find(x => x.slug === a.getAttribute('href').slice(1));
      if (s) sessionMenu(s, e.clientX, e.clientY);
    } else if (wt) worktreeMenu(wt.dataset.wtPath, e.clientX, e.clientY);
    else projectMenu(np, e.clientX, e.clientY);
  });
}
