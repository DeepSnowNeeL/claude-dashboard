// "New session" page: folder choice, one-click start, folder history to resume.
import { $, esc, skeleton, sessionSkeleton } from '../core/dom.js';
import { create, resume } from '../services/sessions.js';
import { readHistory, readFolders } from '../services/projects.js';
import { projects, relativeDir, serverMode } from '../core/state.js';
import { readWorkspace } from '../services/options.js';
import { modeOptions } from '../core/modes.js';
import { t, locale } from '../i18n/index.js';

// On the right of "New session": the folder's past sessions (terminal and page alike), searchable, to resume.
let history = [];
async function loadHistory(dir) {
  const z = $('#right');
  if (!dir?.trim()) { z.innerHTML = `<p class="m">${t('newSession.chooseFolder')}</p>`; return; }
  z.innerHTML = skeleton('lines', 8);
  try { history = await readHistory(dir); } catch (e) { z.innerHTML = `<p class="m">${esc(e.message)}</p>`; return; }
  z.innerHTML = `<section class="block"><h3>${t('newSession.pastSessions')} <span class="m">(${history.length})</span></h3>
    <input id="history-search" class="search" placeholder="${t('newSession.searchHistory')}" autocomplete="off">
    <div id="history-list"></div>
    <p class="m">${t('newSession.resumeWarning')}</p></section>`;
  $('#history-search').addEventListener('input', renderHistory);
  renderHistory();
}
function renderHistory() {
  const q = $('#history-search')?.value.trim().toLowerCase() || '';
  const vis = history.filter(h => !q || [h.title, h.firstPrompt, h.branch, h.sessionId].join(' ').toLowerCase().includes(q));
  // One row per session, sections by day (most recent first)
  const day = ms => {
    const d = new Date(ms), today = new Date();
    const gap = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (gap === 0) return t('newSession.today');
    if (gap === 1) return t('newSession.yesterday');
    return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  };
  let section = null, html = '';
  for (const h of [...vis].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300)) {
    const j = day(h.updatedAt);
    if (j !== section) { section = j; html += `<div class="history-day">${esc(j)}</div>`; }
    html += `<div class="history" title="${esc(h.firstPrompt || '')}">
      <span class="h">${new Date(h.updatedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="t">${h.archived ? `<span title="${t('newSession.archivedPanel')}">📋</span> ${esc(h.archived)}` : esc(h.title || t('newSession.untitled'))}</span>
      ${h.branch && h.branch !== 'master' && h.branch !== 'main' ? `<span class="m br">⎇ ${esc(h.branch)}</span>` : ''}
      ${h.slug ? `<a class="btn" href="#${esc(h.slug)}" title="${t('newSession.alreadyInDashboard')}">${t('newSession.open')}</a>`
        : `<button class="btn" data-resume="${esc(h.sessionId)}" title="${h.archived ? t('newSession.resumeWithPanel') : t('newSession.resumeHere')}">${t('newSession.resume')}</button>`}
    </div>`;
  }
  $('#history-list').innerHTML = html || `<p class="m">${t('newSession.noSession')}</p>`;
  $('#history-list').querySelectorAll('[data-resume]').forEach(b => b.addEventListener('click', async () => {
    const h = history.find(x => x.sessionId === b.dataset.resume);
    // The session shows up at once as a skeleton (its title, feed and panel in grey) while the engine resumes it
    const before = location.hash;
    showLoading(h.archived || h.title);
    try {
      const { slug } = await resume(h);
      if (location.hash === before) location.hash = slug; // not if another view was chosen in the meantime
    } catch (e) { alert(e.message); if (location.hash === before) renderNewSession(h.cwd); }
  }));
}

/** Center and panel as skeletons: the requested session is on its way (resume, creation). */
function showLoading(title) {
  $('#center').innerHTML = sessionSkeleton(title);
  $('#right').innerHTML = skeleton('panel');
}

/** Main worktree of the repository that contains `dir` (tree already loaded), to tell where a new worktree will go. */
function mainOf(dir) {
  const c = pathKey(dir);
  const p = projects().find(pr => pr.worktrees.some(w => c === pathKey(w.path) || c.startsWith(pathKey(w.path) + '/')));
  return p ? (p.worktrees.find(w => w.main) || p.worktrees[0]).path : null;
}
const pathKey = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function renderNewSession(initialCwd) {
  $('#right').classList.remove('mode-git');
  $('#right').innerHTML = '';
  // The folder is known at once: that of the clicked "+", otherwise that of the last displayed session, otherwise the
  // first project of the tree. Nothing waits for the server: it is only typed when clicking "change".
  const treeFolders = projects().flatMap(p => p.worktrees.map(w => w.path));
  const cwd0 = initialCwd || relativeDir() || treeFolders[0] || '';
  $('#center').innerHTML = `
    <div class="head"><div class="title">${t('newSession.title')}</div></div>
    <div class="feed"><form class="new-session-form" id="new-session-form">
      <div class="fixed-folder" ${cwd0 ? '' : 'hidden'}><span class="lbl">${t('newSession.folder')}</span> <span id="cwd-text">📁 ${esc(cwd0)}</span>
        <button type="button" class="btn" id="change-cwd">${t('newSession.change')}</button></div>
      <label id="cwd-input" ${cwd0 ? 'hidden' : ''}>${t('newSession.projectFolder')}<input id="cwd" list="folders" required placeholder="${esc(t('newSession.folderPlaceholder'))}" autocomplete="off" value="${esc(cwd0)}"></label>
      <div class="workspace-folders" id="workspace-folders" hidden></div>
      <datalist id="folders">${treeFolders.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" id="with-worktree"> ${t('newSession.inNewWorktree')}</label>
      <label id="worktree-input" hidden>${t('newSession.branch')}<input id="new-branch" placeholder="${t('newSession.branchPlaceholder')}" autocomplete="off">
        <span class="m" id="worktree-target"></span></label>
      <label>${t('newSession.permissions')}
        <select id="new-session-mode">${modeOptions('all')}</select></label>
      <div class="bar"><span class="m">${t('newSession.readyHint')}</span><button class="btn on large" type="submit">${t('newSession.start')}</button></div>
    </form></div>`;
  if (cwd0) $('#new-session-form button[type=submit]').focus(); // Enter starts the session
  else $('#cwd').focus();
  loadHistory(cwd0);

  // Server mode: the workspace (DASH_WORKSPACE) is the default folder, its subfolders (cloned repositories) one click away
  const chooseFolder = dir => {
    $('#cwd').value = dir;
    $('#cwd-text').textContent = `📁 ${dir}`;
    $('.fixed-folder').hidden = false; $('#cwd-input').hidden = true;
    loadHistory(dir); updateTarget();
    $('#new-session-form button[type=submit]').focus();
  };
  if (serverMode()) readWorkspace().then(ws => {
    if (!ws?.dir || !$('#workspace-folders')) return;
    const known = new Set([...$('#folders').options].map(o => pathKey(o.value)));
    $('#folders').insertAdjacentHTML('beforeend', [ws.dir, ...ws.folders.map(f => f.path)].filter(x => !known.has(pathKey(x))).map(x => `<option value="${esc(x)}">`).join(''));
    if (!$('#cwd').value.trim()) chooseFolder(ws.dir);
    if (!ws.folders.length) return;
    const z = $('#workspace-folders');
    z.innerHTML = `<span class="lbl">${t('newSession.workspace')}</span> ` + ws.folders.map(f =>
      `<button type="button" class="btn" data-ws="${esc(f.path)}" title="${esc(f.path)}">${f.git ? '⎇' : '📁'} ${esc(f.name)}</button>`).join(' ');
    z.hidden = false;
    z.querySelectorAll('[data-ws]').forEach(b => b.addEventListener('click', () => chooseFolder(b.dataset.ws)));
  }).catch(() => {});

  // Changing folder: the input appears, completed with the recent folders of the history (slow, loaded separately)
  let recentLoaded = false;
  const loadRecent = () => {
    if (recentLoaded) return; recentLoaded = true;
    readFolders().then(d => {
      const known = new Set(treeFolders.map(pathKey));
      $('#folders')?.insertAdjacentHTML('beforeend', d.filter(x => !known.has(pathKey(x))).map(x => `<option value="${esc(x)}">`).join(''));
    }).catch(() => {});
  };
  if (!cwd0) loadRecent();
  $('#change-cwd').addEventListener('click', () => {
    $('.fixed-folder').hidden = true; $('#cwd-input').hidden = false;
    $('#cwd').select(); $('#cwd').focus(); loadRecent();
  });
  let pending = null;
  $('#cwd').addEventListener('input', () => { clearTimeout(pending); pending = setTimeout(() => loadHistory($('#cwd').value), 500); updateTarget(); });

  // New worktree (unchecked by default): branch name, and the folder that will be created next to the repository
  const updateTarget = () => {
    const b = $('#new-branch').value.trim(), p = mainOf($('#cwd').value);
    $('#worktree-target').textContent = b && p ? t('newSession.createdIn', { path: `${p}-${b.replace(/[\\/:*?"<>|\s]+/g, '-')}` }) : '';
  };
  $('#with-worktree').addEventListener('change', e => {
    $('#worktree-input').hidden = !e.target.checked;
    $('#new-branch').required = e.target.checked;
    if (e.target.checked) $('#new-branch').focus();
  });
  $('#new-branch').addEventListener('input', updateTarget);

  $('#new-session-form').addEventListener('submit', async e => {
    e.preventDefault();
    const cwd = $('#cwd').value, mode = $('#new-session-mode').value, before = location.hash;
    const branch = $('#with-worktree').checked ? $('#new-branch').value.trim() : '';
    showLoading(t('newSession.title'));
    try {
      // No first message: it opens ready, cursor in its input
      const { slug } = await create(cwd, mode, branch);
      if (location.hash === before) location.hash = slug;
    } catch (err) { alert(err.message); if (location.hash === before) renderNewSession(cwd); }
  });
}
