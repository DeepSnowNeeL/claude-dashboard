// Left tree: groups → projects → worktrees → sessions, each level collapsible (the state is kept in the
// browser). An effect redraws it when the sessions, projects, groups, orders, the displayed session or the folds change.
import { signal, effect } from '../../core/signals.js';
import { sessions, projects, groups, orders, current, listLoaded, serverMode } from '../../core/state.js';
import { $, esc, timeAgo, displayName } from '../../core/dom.js';
import { read, write } from '../../core/storage.js';
import { pathKey, saveGroups as storeGroups, loadList, addProject, saveProjectMeta, removeProject, saveOrder, projectLogoUrl } from '../../services/projects.js';
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
    if (s.status === 'done') f[`t:${wt.id}`] = 1; // the "done" row opens when its key is present
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

function sessionRow(s, worktree) {
  const g = s.status || 'working';
  const drag = worktree && s.status !== 'done' ? `draggable="true" data-drag-session="${esc(s.slug)}" data-wt="${esc(worktree)}"` : '';
  // New items not seen yet (Claude text, agent or shell finished): corner badge, except on the displayed session
  const unread = s.slug !== current() && s.unread;
  return `<a class="sess ${s.slug === current() ? 'sel' : ''} ${s.blocked ? 'blocked' : ''} ${unread ? 'unread' : ''}" href="#${s.slug}" ${drag}${unread ? ` data-n="${unread > 99 ? '99+' : unread}" title="${t('tree.unreadTitle', { n: unread })}"` : ''}>
    <div class="t">${s.driven ? `<span class="dot ${s.busy ? 'busy' : ''}" title="${t('tree.driven')}"></span>` : ''}${displayName(s)}</div>
    ${s.description ? `<div class="d">${esc(s.description)}</div>` : ''}
    ${s.blocked ? `<span class="pill p-blocked" title="${t('tree.blockedTitle')}">${s.blocked === 'permission' ? t('tree.blockedPermission') : t('tree.blockedQuestion')}</span>` : ''}
    <span class="pill p-${esc(g)}">${g === 'waiting' ? '⏳ ' : g === 'done' ? '✓ ' : '⚙ '}${esc(s.statusSummary || s.step)}</span>
    ${s.runningAgents ? `<span class="pill p-agents" title="${t('tree.runningAgents')}">🤖 ${s.runningAgents}</span>` : ''}
    ${s.runningShells ? `<span class="pill p-agents" title="${t('tree.runningShells')}">🐚 ${s.runningShells}</span>` : ''}
    <span class="m">${timeAgo(s.updatedAt)}</span>
  </a>`;
}

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
  const vis = sessions().filter(s => !q || [s.slug, s.title, s.description, s.ticket, s.project].join(' ').toLowerCase().includes(q));
  const folds = readFolds();
  const open = k => q || !folds[k]; // a search unfolds everything

  // Each session goes into the worktree whose path contains its folder most precisely.
  const allWt = projects().flatMap(p => p.worktrees);
  const byWt = new Map(allWt.map(w => [w.id, []]));
  const orphans = [];
  for (const s of vis) {
    const c = pathKey(s.cwd);
    const w = c && allWt.filter(w => c === w.id || c.startsWith(w.id + '/')).sort((a, b) => b.id.length - a.id.length)[0];
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
    const rows = active.map(s => sessionRow(s, key)).join('');
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
    const wts = p.worktrees.map(w => {
      const sess = byWt.get(w.id).sort(byStatus);
      if (q && !sess.length) return '';
      if (single) return sessionRows(sess, w.id);
      const kw = `w:${w.id}`;
      return `<div class="wt">
        <div class="node" data-fold="${esc(kw)}" data-wt-path="${esc(w.path)}" title="${esc(t('tree.worktreeTitle', { path: w.path }))}"><span class="fl">${open(kw) ? '▾' : '▸'}</span>
          <span class="nm">⎇ ${esc(w.branch || w.path.split(/[\\/]/).pop())}</span>${open(kw) ? '' : counters(sess)}${newSession(w)}</div>
        ${open(kw) ? `<div class="children">${sessionRows(sess, w.id)}</div>` : ''}
      </div>`;
    }).join('');
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
      dragged = { slug: a.dataset.dragSession, wt: a.dataset.wt };
      e.dataTransfer.setData('text/x-session', dragged.slug);
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation(); // not the drag of the parent project
    });
    a.addEventListener('dragend', () => { dragged = null; $('#list').querySelectorAll('.target-before, .target-after').forEach(x => x.classList.remove('target-before', 'target-after')); });
    a.addEventListener('dragover', e => {
      if (!dragged || dragged.wt !== a.dataset.wt || dragged.slug === a.dataset.dragSession) return;
      e.preventDefault(); e.stopPropagation();
      const r = a.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      a.classList.toggle('target-after', after); a.classList.toggle('target-before', !after);
    });
    a.addEventListener('dragleave', () => a.classList.remove('target-before', 'target-after'));
    a.addEventListener('drop', e => {
      if (!dragged || dragged.wt !== a.dataset.wt) return;
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
  effect(() => { if (!listLoaded()) return; sessions(); projects(); groups(); orders(); current(); foldsChanged(); renderList(); });
  $('#search').addEventListener('input', renderList);
  mountTreeMenu(el); // right click on a session, a project or a worktree
  for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.addEventListener(ev, dropAim, { passive: true });
  setInterval(renderList, 60000);
}
