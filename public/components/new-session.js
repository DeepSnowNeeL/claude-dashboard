// "New session" page: folder choice, one-click start, folder history to resume.
import { $, esc, skeleton, sessionSkeleton, modelLabel, timeAgo } from '../core/dom.js';
import { create, resume, readAvailableModels } from '../services/sessions.js';
import { readHistory, readFolders, readBranches } from '../services/projects.js';
import { projects, relativeDir, serverMode } from '../core/state.js';
import { readWorkspace } from '../services/options.js';
import { modeOptions, MODE_KEYS } from '../core/modes.js';
import { read, write } from '../core/storage.js';
import { t, locale } from '../i18n/index.js';

// Permission mode of the last session started from this browser: the next one starts with it
const MODE_KEY = 'dash-new-session-mode';
const MODEL_KEY = 'dash-new-session-model';
/** "Default (Opus 5.5)": the model the account's default resolves to. */
const defaultLabel = m => (m.resolvedModel ? t('newSession.modelDefaultIs', { model: modelLabel(m.resolvedModel).name }) : t('newSession.modelDefault'));
const lastMode = () => { const m = read(MODE_KEY, 'all'); return MODE_KEYS.includes(m) ? m : 'all'; };

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
      <div class="start-branch" id="start-branch-zone" hidden>
        <label for="start-branch">${t('newSession.startBranch')} <span class="m">${t('newSession.startBranchOptional')}</span></label>
        <input id="start-branch" placeholder="${esc(t('newSession.startBranchPlaceholder'))}" autocomplete="off" spellcheck="false">
        <div class="branch-list" id="branch-list" hidden></div>
        <div class="branch-modes" id="branch-modes" hidden>
          <label class="check"><input type="radio" name="branch-mode" value="on"> <span id="mode-on-label"></span></label>
          <span class="m branch-target" id="target-on"></span>
          <label class="check"><input type="radio" name="branch-mode" value="new"> <span id="mode-new-label"></span></label>
          <input id="new-branch" placeholder="${t('newSession.branchPlaceholder')}" autocomplete="off" spellcheck="false" hidden>
          <span class="m branch-target" id="target-new"></span>
        </div>
        <span class="m branch-target" id="branch-hint"></span>
      </div>
      <label>${t('newSession.permissions')}
        <select id="new-session-mode">${modeOptions(lastMode())}</select></label>
      <label>${t('newSession.model')}
        <select id="new-session-model"><option value="default">${t('newSession.modelDefault')}</option></select></label>
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
    loadHistory(dir); loadBranches(dir);
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
  $('#cwd').addEventListener('input', () => { clearTimeout(pending); pending = setTimeout(() => { loadHistory($('#cwd').value); loadBranches($('#cwd').value); }, 500); });

  // Starting branch (empty by default: the session opens in the folder as it is). A known branch offers "Work on it"
  // (the worktree that has it checked out, otherwise a new one) or "New branch from it" (new worktree); a name that
  // matches no branch creates it from the HEAD of the main worktree, as before.
  let branchList = [], chosen = null, active = -1;
  const loadBranches = dir => {
    branchList = []; chosen = null;
    $('#start-branch-zone').hidden = true;
    if (!dir?.trim()) return;
    readBranches(dir).then(l => {
      if (pathKey($('#cwd')?.value) !== pathKey(dir)) return; // folder changed meanwhile
      branchList = l; $('#start-branch-zone').hidden = !l.length; updateTarget();
    }).catch(() => {});
  };
  const targetOf = b => { const p = mainOf($('#cwd').value); return b && p ? `${p}-${b.replace(/[\\/:*?"<>|\s]+/g, '-')}` : ''; };
  const branchMode = () => document.querySelector('input[name=branch-mode]:checked')?.value || 'on';
  const updateTarget = () => {
    const typed = $('#start-branch').value.trim();
    chosen = branchList.find(b => b.name === typed) || null;
    $('#branch-modes').hidden = !chosen;
    const unknown = typed && !chosen;
    $('#branch-hint').textContent = unknown ? t('newSession.newBranchFromHead', { branch: typed, path: targetOf(typed) }) : '';
    $('#new-branch').required = !!chosen && branchMode() === 'new';
    $('#new-branch').hidden = !chosen || branchMode() !== 'new';
    if (!chosen) return;
    $('#mode-on-label').innerHTML = t('newSession.workOn', { branch: `<b>${esc(chosen.local)}</b>` });
    $('#mode-new-label').innerHTML = t('newSession.newBranchFrom', { branch: `<b>${esc(chosen.name)}</b>` });
    $('#target-on').textContent = chosen.worktree ? t('newSession.existingWorktree', { path: chosen.worktree }) : t('newSession.createdIn', { path: targetOf(chosen.local) });
    const nb = $('#new-branch').value.trim();
    $('#target-new').textContent = branchMode() === 'new' && nb ? t('newSession.createdIn', { path: targetOf(nb) }) : '';
  };
  // Suggestions: main, master, develop… first, then epic/* and release/* (main ones), local, remote; filtered as typed
  const FIRST = ['main', 'master', 'develop', 'dev', 'trunk'];
  const firstRank = b => { const i = FIRST.indexOf(b.local); return i < 0 ? FIRST.length : i; };
  let shown = [];
  const renderBranchList = () => {
    const q = $('#start-branch').value.trim().toLowerCase();
    const hit = branchList.filter(b => !q || b.name.toLowerCase().includes(q));
    const groupsOf = [
      ['main', hit.filter(b => b.main).sort((a, b) => firstRank(a) - firstRank(b) || b.date - a.date).slice(0, 15)],
      ['local', hit.filter(b => !b.main && !b.remote).slice(0, 30)],
      ['remote', hit.filter(b => !b.main && b.remote).slice(0, 20)],
    ].filter(([, l]) => l.length);
    shown = groupsOf.flatMap(([, l]) => l);
    active = Math.min(active, shown.length - 1);
    const z = $('#branch-list');
    z.hidden = !shown.length;
    let i = 0;
    z.innerHTML = groupsOf.map(([g, l]) => `<div class="g">${t(`newSession.branchGroups.${g}`)}</div>`
      + l.map(b => `<div class="o ${i === active ? 'on' : ''}" data-i="${i++}"><span class="nm">${esc(b.name)}</span>`
        + `<span class="w">${b.worktree ? `⎇ ${esc(b.worktree.split(/[\\/]/).pop())}` : esc(timeAgo(new Date(b.date).toISOString()))}</span></div>`).join('')).join('');
    z.querySelectorAll('[data-i]').forEach(o => o.addEventListener('mousedown', e => { e.preventDefault(); pick(shown[+o.dataset.i]); }));
  };
  const pick = b => {
    $('#start-branch').value = b.name;
    $('#branch-list').hidden = true; active = -1;
    // A starting branch (develop, epic/…) usually gets a new branch; any other one is worked on
    document.querySelector(`input[name=branch-mode][value=${b.main ? 'new' : 'on'}]`).checked = true;
    updateTarget();
    if (b.main) $('#new-branch').focus();
  };
  $('#start-branch').addEventListener('focus', renderBranchList);
  $('#start-branch').addEventListener('blur', () => { $('#branch-list').hidden = true; active = -1; });
  $('#start-branch').addEventListener('input', () => { active = -1; renderBranchList(); updateTarget(); });
  $('#start-branch').addEventListener('keydown', e => {
    if ($('#branch-list').hidden) { if (e.key === 'ArrowDown') renderBranchList(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      renderBranchList();
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { $('#branch-list').hidden = true; active = -1; }
  });
  document.querySelectorAll('input[name=branch-mode]').forEach(r => r.addEventListener('change', () => { updateTarget(); if (branchMode() === 'new') $('#new-branch').focus(); }));
  $('#new-branch').addEventListener('input', updateTarget);
  loadBranches(cwd0);
  // Models of the SDK, read in the background: the form is usable (default model) while they load
  readAvailableModels().then(({ models }) => {
    const sel = $('#new-session-model'), last = read(MODEL_KEY, 'default');
    if (!sel) return;
    sel.innerHTML = models.map(m => `<option value="${esc(m.value)}" title="${esc(m.description || '')}" ${m.value === last ? 'selected' : ''}>${esc(m.value === 'default' ? defaultLabel(m) : m.displayName || m.value)}</option>`).join('');
  }).catch(() => { $('#new-session-model')?.closest('label')?.setAttribute('hidden', ''); });

  $('#new-session-form').addEventListener('submit', async e => {
    e.preventDefault();
    let cwd = $('#cwd').value;
    const mode = $('#new-session-mode').value, before = location.hash;
    write(MODE_KEY, mode);
    const model = $('#new-session-model')?.value || 'default';
    write(MODEL_KEY, model);
    // Starting branch: worktree that already has it, new worktree on it, or new branch from it (`base`)
    const typed = $('#start-branch').value.trim();
    let branch = '', base = '';
    if (typed && !chosen) branch = typed;
    else if (chosen && branchMode() === 'new') { branch = $('#new-branch').value.trim(); base = chosen.name; }
    else if (chosen?.worktree) cwd = chosen.worktree;
    else if (chosen) { branch = chosen.local; base = chosen.remote ? chosen.name : ''; }
    showLoading(t('newSession.title'));
    try {
      // No first message: it opens ready, cursor in its input
      const { slug } = await create(cwd, mode, branch, model, '', base);
      if (location.hash === before) location.hash = slug;
    } catch (err) { alert(err.message); if (location.hash === before) renderNewSession(cwd); }
  });
}
