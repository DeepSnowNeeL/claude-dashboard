// Left tree: groups → projects → worktrees → sessions, each level collapsible (the state is kept in the
// browser). An effect redraws it when the sessions, projects, groups, orders, the displayed session or the folds change.
import { signal, effect } from '../../core/signals.js';
import { sessions, projects, groups, orders, categories, current, listLoaded, serverMode } from '../../core/state.js';
import { $, esc, timeAgo, displayName, ticketTag, statusPills } from '../../core/dom.js';
import { read, write } from '../../core/storage.js';
import { pathKey, saveGroups as storeGroups, loadList, addProject, saveProjectMeta, removeProject, saveOrder, projectLogoUrl, categoriesOf } from '../../services/projects.js';
import { t } from '../../i18n/index.js';
import { ask } from './modal.js';
import { edit } from './edit.js';
import { mountTreeMenu } from './menu.js';

/** Saves the groups; a network error shows up as an alert. */
const saveGroups = async next => { try { await storeGroups(next); } catch (e) { alert(e.message); } };

const UNGROUPED_KEY = 'projects:ungrouped'; // manual order of the ungrouped projects, kept with the session orders (orders.json)
let ungroupedOrder = []; // ids of the ungrouped projects, in displayed order (last render)

const foldsChanged = signal(0); // the folds live in localStorage; this signal says they changed

const foldsKey = 'dash-folds';
function readFolds() { return read(foldsKey, {}) || {}; }
/**
 * Session opened (resume, link, notification): its group, its project, its worktree and, if it is done, the
 * "done" row unfold, then the list scrolls to it.
 */
export function revealInTree(s) {
  const c = pathKey(s.cwd);
  const f = readFolds();
  const project = projects().find(pr => pr.worktrees.some(w => c === w.id || c.startsWith(w.id + '/')));
  if (project) {
    const wt = project.worktrees.filter(w => c === w.id || c.startsWith(w.id + '/')).sort((a, b) => b.id.length - a.id.length)[0];
    delete f[`p:${project.id}`];
    delete f[`w:${wt.id}`];
    const g = groups().find(x => x.projects.includes(project.id));
    if (g) delete f[`g:${g.id}`];
    if (s.status === 'done') {
      f[`t:${wt.id}`] = 1; // the "done" row opens when its key is present
      if (!wt.main) f[`o:${project.id}`] = 1; // its worktree may sit under "other worktrees" (same rule)
    }
  } else {
    delete f['p:others'];
    if (s.status === 'done') f['t:others'] = 1;
  }
  write(foldsKey, f);
  foldsChanged.update(n => n + 1);
  // Immediate scroll, replayed after the list refreshes that follow the opening (SSE, list reloaded).
  // `nearest`: a session already visible (opened by a click in the tree) does not move the list; and as soon as
  // the user scrolls the list themselves, the replays are dropped (otherwise it came back under their fingers).
  const token = ++aim;
  const scroll = () => { if (token === aim) $('#list .sess.sel')?.scrollIntoView({ block: 'nearest' }); };
  requestAnimationFrame(scroll); setTimeout(scroll, 400); setTimeout(scroll, 1200);
}
let aim = 0; // incremented on each opening and each manual scroll of the list: a stale replay no longer aims
const dropAim = () => { aim++; };

function toggleFold(k) { const f = readFolds(); if (f[k]) delete f[k]; else f[k] = 1; write(foldsKey, f); foldsChanged.update(n => n + 1); }

const STATUS_ORDER = { waiting: 0, working: 1, done: 2 };
/** Creation date of a session, read from its slug (`n-` + Date.now() in base 36); 0 for a terminal session. */
const createdAt = s => (/^n-[0-9a-z]{8}/.test(s.slug) ? parseInt(s.slug.slice(2, 10), 36) : 0);
export const byStatus = (a, b) => (STATUS_ORDER[a.status || 'working'] - STATUS_ORDER[b.status || 'working']) || String(b.updatedAt).localeCompare(String(a.updatedAt));

/**
 * Row of a session. `nest`: slug of the parent it is drawn under (a launched session, same worktree), '' otherwise;
 * `kids`: number of sessions drawn under it.
 */
function sessionRow(s, worktree, { nest = '', kids = 0 } = {}) {
  const drag = worktree && s.status !== 'done' ? `draggable="true" data-drag-session="${esc(s.slug)}" data-wt="${esc(worktree)}" data-nest="${esc(nest)}"` : '';
  // New items not seen yet (Claude text, agent or shell finished): corner badge, except on the displayed session
  const unread = s.slug !== current() && s.unread;
  // Launched by a session that is not right above it (other worktree or project, parent ended): link to that one
  const parent = !nest && s.parent && sessions().find(x => x.slug === s.parent);
  // Categories: the first one colours the row; one marked "compact" reduces it to a single line
  const cats = categoriesOf(s.slug);
  const color = cats[0] ? ` style="--c:${esc(cats[0].color)}"` : '';
  const cls = `${s.slug === current() ? 'sel' : ''} ${s.blocked ? 'blocked' : ''} ${unread ? 'unread' : ''}`;
  const badge = `${drag}${unread ? ` data-n="${unread > 99 ? '99+' : unread}" title="${t('tree.unreadTitle', { n: unread })}"` : ''}`;
  if (cats.some(c => c.compact)) {
    // Only what calls for attention stays: blocked (icon), status (icon, summary in the tooltip), unread badge
    const g = s.status || 'working';
    const blocked = s.blocked ? t(s.blocked === 'permission' ? 'tree.blockedPermission' : s.blocked === 'plan' ? 'tree.blockedPlan' : 'tree.blockedQuestion') : '';
    return `<a class="sess compact ${cls}" href="#${s.slug}" ${badge}${color}>
      ${s.driven ? `<span class="dot ${s.busy ? 'busy' : ''}" title="${t('tree.driven')}"></span>` : ''}<span class="t" title="${esc([s.title || s.slug, ...cats.map(c => c.name)].join(' · '))}">${displayName(s)}</span>${kids ? `<span class="kids-count" title="${t('tree.kidsTitle', { n: kids })}">↳ ${kids}</span>` : ''}
      ${blocked ? `<span class="pill p-blocked" title="${esc(blocked)}">${esc(blocked.split(' ')[0])}</span>` : ''}
      <span class="st" title="${esc(s.statusSummary || s.step || '')}">${g === 'waiting' ? '⏳' : g === 'done' ? '✓' : '⚙'}</span>
      <span class="m">${timeAgo(s.updatedAt)}</span>
    </a>`;
  }
  return `<a class="sess ${cls} ${cats.length ? 'has-cat' : ''}" href="#${s.slug}" ${badge}${color}>
    ${parent ? `<span class="parent" data-parent="${esc(parent.slug)}" title="${t('tree.parentTitle')}">↖ ${t('tree.launchedBy', { name: displayName(parent) })}</span>` : ''}
    <div class="t">${s.driven ? `<span class="dot ${s.busy ? 'busy' : ''}" title="${t('tree.driven')}"></span>` : ''}${displayName(s)}${kids ? `<span class="kids-count" title="${t('tree.kidsTitle', { n: kids })}">↳ ${kids}</span>` : ''}</div>
    ${ticketTag(s)}
    ${cats.length ? `<div class="cats">${cats.map(c => `<span class="cat" style="--c:${esc(c.color)}">${esc(c.name)}</span>`).join('')}</div>` : ''}
    ${s.description ? `<div class="d">${esc(s.description)}</div>` : ''}
    ${statusPills(s)}
    <span class="m">${timeAgo(s.updatedAt)}</span>
  </a>`;
}

/** Ticket read in a branch name: `PROJ-31` in feat/PROJ-31-login, or the leading number of 2680-export. */
const branchTicket = b => String(b || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0] || String(b || '').match(/(?:^|\/)(\d{3,})(?=[-_]|$)/)?.[1] || '';
const RECENT_DAYS = 7;
/** A worktree stays in view when it is the main one or has a session still open, or ended less than a week ago. */
const inView = (w, sess) => w.main || sess.some(s => s.status !== 'done' || Date.now() - Date.parse(s.updatedAt) < RECENT_DAYS * 86_400_000);
const baseName = p => p.split(/[\\/]/).pop();
const parentDir = p => p.replace(/[\\/][^\\/]*$/, '');

/** Summary of a collapsed node: unseen new items, blocked sessions, sessions waiting for an answer, running ones. */
function counters(sess) {
  const unread = sess.reduce((n, s) => n + (s.slug !== current() && s.unread || 0), 0);
  const waiting = sess.filter(s => s.status === 'waiting').length;
  const working = sess.filter(s => s.busy).length;
  const blocked = sess.filter(s => s.blocked).length;
  return `${unread ? `<span class="count unread" title="${t('tree.counters.unread')}">● ${unread}</span>` : ''}${blocked ? `<span class="count blocked" title="${t('tree.counters.blocked')}">❗ ${blocked}</span>` : ''}${waiting ? `<span class="count waiting" title="${t('tree.counters.waiting')}">⏳ ${waiting}</span>` : ''}${working ? `<span class="count working" title="${t('tree.counters.working')}">⚙ ${working}</span>` : ''}${sess.length ? `<span class="count">${sess.length}</span>` : ''}`;
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const vis = sessions().filter(s => !q || [s.slug, s.title, s.description, s.ticket, s.project, ...categoriesOf(s.slug).map(c => c.name)].join(' ').toLowerCase().includes(q));
  const folds = readFolds();
  const open = k => q || !folds[k]; // a search unfolds everything

  // Each session goes into the worktree whose path contains its folder most precisely.
  const allWt = projects().flatMap(p => p.worktrees);
  const byWt = new Map(allWt.map(w => [w.id, []]));
  const orphans = [];
  // A worktree removed since (merged branch): its folder `<repo>-<branch>` (createWorktree, Orca) no longer shows in
  // `git worktree list`; its sessions go back to the main worktree of the repo instead of "Terminal sessions"
  const mains = allWt.filter(w => w.main);
  for (const s of vis) {
    const c = pathKey(s.cwd);
    const longest = l => l.sort((a, b) => b.id.length - a.id.length)[0];
    const w = c && (longest(allWt.filter(w => c === w.id || c.startsWith(w.id + '/'))) || longest(mains.filter(w => c.startsWith(w.id + '-'))));
    if (w) byWt.get(w.id).push(s); else orphans.push(s);
  }

  // Done sessions go under a collapsed row (collapsed by default: its key in the folds means open)
  const sessionRows = (sess, key) => {
    const finished = sess.filter(s => s.status === 'done');
    // Manual order of the worktree if it exists (drag and drop); sessions that have no place in it yet go
    // first, newest to oldest. Never by status or last activity: a session that works or waits does not move
    // under the mouse.
    const ord = orders()[key] || [];
    const rank = s => { const i = ord.indexOf(s.slug); return i < 0 ? -1 : i; };
    const active = sess.filter(s => s.status !== 'done').sort((a, b) => (rank(a) - rank(b)) || (createdAt(b) - createdAt(a)));
    // A session launched by another active one of this worktree goes under it, indented, in launch order
    const bySlug = new Map(active.map(s => [s.slug, s]));
    const isNested = s => s.parent && s.parent !== s.slug && bySlug.has(s.parent);
    const kidsOf = slug => active.filter(s => s.parent === slug && isNested(s)).sort((a, b) => (rank(a) - rank(b)) || (createdAt(a) - createdAt(b)));
    const withKids = (s, depth = 0) => {
      const kids = depth < 8 ? kidsOf(s.slug) : []; // a loop between parents never runs forever
      return sessionRow(s, key, { nest: isNested(s) ? s.parent : '', kids: kids.length })
        + (kids.length ? `<div class="kids">${kids.map(k => `<div class="kid">${withKids(k, depth + 1)}</div>`).join('')}</div>` : '');
    };
    const rows = active.filter(s => !isNested(s)).map(s => withKids(s)).join('');
    if (!finished.length) return rows;
    const kt = `t:${key}`, show = q || folds[kt];
    return rows + `<div class="node nt" data-fold="${esc(kt)}"><span class="fl">${show ? '▾' : '▸'}</span>
      <span class="nm">✓ ${t('tree.doneCount', { n: finished.length })}</span></div>
      ${show ? `<div class="children finished">${finished.map(s => sessionRow(s)).join('')}</div>` : ''}`;
  };
  // "+": the folder's "New session" page, where a session starts with one click or an old one is resumed
  const newSession = w => `<a class="plus" href="#new?cwd=${encodeURIComponent(w.path)}" title="${esc(t('tree.newSessionIn', { path: w.path }))}">+</a>`;
  const sessionsOf = p => p.worktrees.flatMap(w => byWt.get(w.id));
  const projectBlock = p => {
    const sessP = sessionsOf(p);
    if (q && !sessP.length) return '';
    const kp = `p:${p.id}`;
    const single = p.worktrees.length === 1;
    // Main worktree (⌂), on a branch (⎇) or detached (⊘: short commit and folder, nothing else tells them apart)
    const mainParent = pathKey(parentDir(p.path));
    const wtNode = w => {
      const sess = byWt.get(w.id).sort(byStatus);
      if (q && !sess.length) return '';
      const kw = `w:${w.id}`;
      const ic = w.main ? '⌂' : w.detached ? '⊘' : '⎇';
      const icTitle = t(w.main ? 'tree.worktree.main' : w.detached ? 'tree.worktree.detached' : 'tree.worktree.branch');
      const name = w.branch || (w.detached && w.head) || baseName(w.path);
      const where = w.branch ? '' : baseName(w.path) + (pathKey(parentDir(w.path)) !== mainParent ? ` · ${parentDir(w.path)}` : '');
      const tk = branchTicket(w.branch);
      return `<div class="wt">
        <div class="node ${w.detached ? 'det' : ''}" data-fold="${esc(kw)}" data-wt-path="${esc(w.path)}" title="${esc(t('tree.worktreeTitle', { path: w.path }))}"><span class="fl">${open(kw) ? '▾' : '▸'}</span>
          <span class="ic" title="${esc(icTitle)}">${ic}</span><span class="nm">${esc(name)}</span>${where ? `<span class="sub">${esc(where)}</span>` : ''}${tk ? `<span class="wt-tk">${esc(tk)}</span>` : ''}${open(kw) ? '' : counters(sess)}${newSession(w)}</div>
        ${open(kw) ? `<div class="children">${sessionRows(sess, w.id)}</div>` : ''}
      </div>`;
    };
    let wts;
    if (single) wts = q && !byWt.get(p.worktrees[0].id).length ? '' : sessionRows(byWt.get(p.worktrees[0].id).sort(byStatus), p.worktrees[0].id);
    else {
      // The worktrees without recent work fold under one row (closed by default: its key in the folds means open),
      // those on a branch first, the detached ones after. A search shows the matching ones directly.
      const shown = q ? p.worktrees : p.worktrees.filter(w => inView(w, byWt.get(w.id)));
      const rest = q ? [] : p.worktrees.filter(w => !shown.includes(w)).sort((a, b) => a.detached - b.detached);
      const ko = `o:${p.id}`, detached = rest.filter(w => w.detached).length;
      wts = shown.map(wtNode).join('') + (rest.length ? `<div class="wt others">
        <div class="node no" data-fold="${esc(ko)}"><span class="fl">${folds[ko] ? '▾' : '▸'}</span>
          <span class="nm">${t('tree.otherWorktrees', { n: rest.length })}</span>${detached ? `<span class="count" title="${esc(t('tree.worktree.detached'))}">${t('tree.detachedCount', { n: detached })}</span>` : ''}</div>
        ${folds[ko] ? `<div class="children">${rest.map(wtNode).join('')}</div>` : ''}
      </div>` : '');
    }
    return `<div class="project">
      <div class="node np" data-fold="${esc(kp)}" draggable="true" data-project="${esc(p.id)}" title="${esc(t('tree.projectTitle', { path: p.path }))}"><span class="fl">${open(kp) ? '▾' : '▸'}</span>
        ${p.icon ? `<span class="project-icon">${esc(p.icon)}</span>` : p.logo ? `<img class="project-logo" src="${projectLogoUrl(p.id)}" alt="">` : ''}<span class="nm" ${p.color ? `style="color:${esc(p.color)}"` : ''}>${esc(p.name)}</span>${open(kp) ? '' : counters(sessP)}${single ? newSession(p.worktrees[0]) : ''}<button class="plus menu" data-edit-project="${esc(p.id)}" title="${t('tree.editProject')}">⋯</button></div>
      ${open(kp) ? `<div class="children">${wts}</div>` : ''}
    </div>`;
  };

  // Project groups, on top; ungrouped projects follow (an "ungrouped" zone to drop a project into).
  const byId = new Map(projects().map(p => [p.id, p]));
  const placed = new Set();
  const groupsHtml = groups().map(g => {
    const ps = g.projects.map(id => byId.get(id)).filter(Boolean);
    ps.forEach(p => placed.add(p.id));
    const sessG = ps.flatMap(sessionsOf);
    if (q && !sessG.length) return '';
    const kg = `g:${g.id}`;
    // The group color runs as a bar along its whole height: its projects are spotted at a glance
    return `<div class="group-p" data-group="${esc(g.id)}" ${g.color ? `style="--group:${esc(g.color)}"` : ''}>
      <div class="node ng" data-fold="${esc(kg)}"><span class="fl">${open(kg) ? '▾' : '▸'}</span>
        <span class="nm">${esc(g.name)}</span>${open(kg) ? '' : counters(sessG)}<button class="plus menu" data-edit-group="${esc(g.id)}" title="${t('tree.editGroup')}">⋯</button></div>
      ${open(kg) ? `<div class="children">${ps.map(projectBlock).join('') || `<p class="m empty">${t('tree.dropProjectHere')}</p>`}</div>` : ''}
    </div>`;
  }).join('');
  // Ungrouped: manual order first, the others (new ones) next by name
  const manual = orders()[UNGROUPED_KEY] || [];
  const rank = id => { const i = manual.indexOf(id); return i < 0 ? Infinity : i; };
  const ungroupedProjects = projects().filter(p => !placed.has(p.id)).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  ungroupedOrder = ungroupedProjects.map(p => p.id);
  const ungrouped = ungroupedProjects.map(projectBlock).join('');
  const html = groupsHtml + (groups().length ? `<div class="ungrouped" data-group=""><div class="m lbl-ungrouped">${ungrouped ? t('tree.ungrouped') : t('tree.ungroupedEmpty')}</div>${ungrouped}</div>` : ungrouped)
    + (orphans.length ? `<div class="project">
      <div class="node np" data-fold="p:others"><span class="fl">${open('p:others') ? '▾' : '▸'}</span><span class="nm">${t('tree.terminalSessions')}</span>${open('p:others') ? '' : counters(orphans)}</div>
      ${open('p:others') ? `<div class="children">${sessionRows(orphans.sort(byStatus), 'others')}</div>` : ''}
    </div>` : '');

  $('#list').innerHTML = (html || `<p class="m">${t('tree.noSession')}</p>`)
    + `<div class="insertions"><button class="btn" id="add-project">${t('tree.addProject')}</button><button class="btn" id="add-group">${t('tree.addGroup')}</button></div>`;
  $('#list').querySelectorAll('[data-fold]').forEach(n => n.addEventListener('click', e => { if (!e.target.closest('.plus')) toggleFold(n.dataset.fold); }));
  // "↖ launched by": opens the parent (the rest of the row opens the session itself)
  $('#list').querySelectorAll('[data-parent]').forEach(x => x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); location.hash = x.dataset.parent; }));
  $('#add-project').addEventListener('click', async () => {
    // In the app: native folder picker. In a remote browser: type the path (server side).
    const type = () => ask({ title: t('tree.newProject.title'), label: t('tree.newProject.label'), placeholder: t('tree.newProject.placeholder') });
    let path;
    // App started before the native picker was added (its main process has no handler): type the path
    // Server mode: the folder is on the server, never the local picker
    try { path = !serverMode() && window.desktop?.chooseFolder ? await window.desktop.chooseFolder() : await type(); }
    catch { path = await type(); }
    window.desktop?.restoreFocus?.(); // after the native dialog, the page no longer gets the keyboard
    if (!path) return;
    // Folder already covered by a project (itself, one of its worktrees or a subfolder): say so, otherwise nothing moves
    const c = pathKey(path);
    const already = projects().find(p => p.worktrees.some(w => c === w.id || c.startsWith(w.id + '/')));
    try { await addProject(path); await loadList(); } catch (err) { alert(err.message); return; }
    if (already) alert(t('tree.newProject.already', { path, project: already.name }));
  });
  $('#add-group').addEventListener('click', async () => {
    const n = await ask({ title: t('tree.newGroup.title'), label: t('tree.newGroup.label') });
    if (n) saveGroups([...groups(), { id: Date.now().toString(36), name: n, projects: [] }]);
  });
  $('#list').querySelectorAll('[data-edit-group]').forEach(b => b.addEventListener('click', () => {
    const g = groups().find(x => x.id === b.dataset.editGroup);
    if (!g) return;
    edit({
      title: t('tree.editGroupTitle'), name: g.name, color: g.color,
      save: v => saveGroups(groups().map(x => (x === g ? { ...x, name: v.name || x.name, color: v.color || undefined } : x))),
      remove: { label: t('tree.removeGroup'), confirm: t('tree.removeGroupConfirm', { name: g.name }), run: () => saveGroups(groups().filter(x => x !== g)) },
    });
  }));
  $('#list').querySelectorAll('[data-edit-project]').forEach(b => b.addEventListener('click', () => {
    const p = projects().find(x => x.id === b.dataset.editProject);
    if (!p) return;
    edit({
      title: t('tree.editProjectTitle'), subtitle: p.path, name: p.name, defaultName: p.dirName, color: p.color, icon: p.icon ?? '', withIcon: true, logo: p.logo && projectLogoUrl(p.id),
      group: groups().find(g => g.projects.includes(p.id))?.id || '', ticketUrl: p.ticketUrl || '',
      save: async v => {
        // Group change: the project leaves the old one and goes at the end of the new one
        const before = groups().find(g => g.projects.includes(p.id))?.id || '';
        if (v.group !== before) await saveGroups(groups().map(g => ({ ...g, projects: g.id === v.group ? [...g.projects.filter(x => x !== p.id), p.id] : g.projects.filter(x => x !== p.id) })));
        await saveProjectMeta({ id: p.id, name: v.name === p.dirName ? '' : v.name, color: v.color, icon: v.icon, ticketUrl: v.ticketUrl });
        loadList();
      },
      remove: { label: t('tree.removeFromTree'), confirm: t('tree.removeProjectConfirm', { name: p.name }),
        run: () => removeProject(p.path).then(loadList).catch(e => alert(e.message)) },
    });
  }));
  // Drag and drop of a session onto another of the same worktree: it takes its place (above or below
  // depending on the hovered half); the order is kept server side.
  let dragged = null;
  $('#list').querySelectorAll('[data-drag-session]').forEach(a => {
    a.addEventListener('dragstart', e => {
      dragged = { slug: a.dataset.dragSession, wt: a.dataset.wt, nest: a.dataset.nest };
      e.dataTransfer.setData('text/x-session', dragged.slug);
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation(); // not the drag of the parent project
    });
    a.addEventListener('dragend', () => { dragged = null; $('#list').querySelectorAll('.target-before, .target-after').forEach(x => x.classList.remove('target-before', 'target-after')); });
    a.addEventListener('dragover', e => {
      // Within the same level only: a launched session moves among its sisters, its parent takes it along
      if (!dragged || dragged.wt !== a.dataset.wt || dragged.nest !== a.dataset.nest || dragged.slug === a.dataset.dragSession) return;
      e.preventDefault(); e.stopPropagation();
      const r = a.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      a.classList.toggle('target-after', after); a.classList.toggle('target-before', !after);
    });
    a.addEventListener('dragleave', () => a.classList.remove('target-before', 'target-after'));
    a.addEventListener('drop', e => {
      if (!dragged || dragged.wt !== a.dataset.wt || dragged.nest !== a.dataset.nest) return;
      e.preventDefault(); e.stopPropagation();
      const after = a.classList.contains('target-after');
      a.classList.remove('target-before', 'target-after');
      const wt = a.dataset.wt;
      const visible = [...$('#list').querySelectorAll(`[data-drag-session][data-wt="${CSS.escape(wt)}"]`)].map(x => x.dataset.dragSession);
      const order = visible.filter(s => s !== dragged.slug);
      order.splice(order.indexOf(a.dataset.dragSession) + (after ? 1 : 0), 0, dragged.slug);
      orders()[wt] = order;
      dragged = null;
      orders.notify();
      saveOrder(wt, order).catch(err => alert(err.message));
    });
  });
  // Drag and drop: a project onto a group puts it there (instead of its previous group), onto "ungrouped" takes it out.
  $('#list').querySelectorAll('[data-project]').forEach(n => n.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/x-project', n.dataset.project);
    e.dataTransfer.effectAllowed = 'move';
  }));
  // A project dropped onto another goes above or below it (depending on the hovered half), in that one's group
  // or ungrouped: a group's order is its list, the ungrouped projects' order goes into orders.json.
  $('#list').querySelectorAll('.np[data-project]').forEach(n => {
    const clean = () => n.classList.remove('target-before', 'target-after');
    n.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-project')) return;
      e.preventDefault(); e.stopPropagation();
      n.closest('[data-group]')?.classList.remove('target');
      const r = n.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      n.classList.toggle('target-after', after); n.classList.toggle('target-before', !after);
    });
    n.addEventListener('dragleave', clean);
    n.addEventListener('drop', e => {
      if (!e.dataTransfer.types.includes('text/x-project')) return;
      e.preventDefault(); e.stopPropagation();
      const after = n.classList.contains('target-after');
      clean();
      const id = e.dataTransfer.getData('text/x-project'), target = n.dataset.project;
      if (!id || id === target) return;
      const place = list => { const l = list.filter(x => x !== id); l.splice(l.indexOf(target) + (after ? 1 : 0), 0, id); return l; };
      const group = n.closest('[data-group]')?.dataset.group || '';
      if (group) {
        saveGroups(groups().map(g => ({ ...g, projects: g.id === group ? place(g.projects) : g.projects.filter(x => x !== id) })));
        return;
      }
      const order = place(ungroupedOrder);
      orders()[UNGROUPED_KEY] = order;
      orders.notify();
      saveOrder(UNGROUPED_KEY, order).catch(err => alert(err.message));
      if (groups().some(g => g.projects.includes(id))) saveGroups(groups().map(g => ({ ...g, projects: g.projects.filter(x => x !== id) })));
    });
  });
  $('#list').querySelectorAll('[data-group]').forEach(z => {
    z.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-project')) { e.preventDefault(); e.stopPropagation(); z.classList.add('target'); } });
    z.addEventListener('dragleave', () => z.classList.remove('target'));
    z.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const id = e.dataTransfer.getData('text/x-project');
      const target = z.dataset.group;
      saveGroups(groups().map(g => ({ ...g, projects: g.id === target ? [...g.projects.filter(x => x !== id), id] : g.projects.filter(x => x !== id) })));
    });
  });
}

/** Mounts the tree in `el` (#list): an effect draws it, the search and passing time ("… ago") redraw it. */
export function mountTree(el) {
  // Tab title (and the app window title): the total of unseen new items
  effect(() => {
    // the displayed session counts as long as the window is not in the foreground (like the app icon)
    const n = sessions().reduce((sum, s) => sum + (s.slug === current() && document.hasFocus() ? 0 : s.unread || 0), 0);
    document.title = n ? `(${n}) ${t('tree.windowTitle')}` : t('tree.windowTitle');
  });
  // Nothing before the first list load (otherwise "No sessions." would flash for a moment)
  effect(() => { if (!listLoaded()) return; sessions(); projects(); groups(); orders(); categories(); current(); foldsChanged(); renderList(); });
  $('#search').addEventListener('input', renderList);
  mountTreeMenu(el); // right click on a session, a project or a worktree
  for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.addEventListener(ev, dropAim, { passive: true });
  setInterval(renderList, 60000);
}
