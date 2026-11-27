// "New session" page: folder choice, one-click start, folder history to resume.
import { $, esc, skeleton, sessionSkeleton, modelLabel, timeAgo } from '../core/dom.js';
import { create, resume, readAvailableModels } from '../services/sessions.js';
import { readHistory, readFolders, readBranches, pathKey } from '../services/projects.js';
import { projects, sessions, relativeDir, serverMode } from '../core/state.js';
import { readWorkspace } from '../services/options.js';
import { modeOptions, MODE_KEYS } from '../core/modes.js';
import { read, write } from '../core/storage.js';
import { t, locale } from '../i18n/index.js';

// Permission mode of the last session started from this browser: the next one starts with it
const MODE_KEY = 'dash-new-session-mode';
const MODEL_KEY = 'dash-new-session-model';
/** "Default (Opus 5.5)": the model the account's default resolves to. */
const defaultLabel = m => (m.resolvedModel ? t('newSession.modelDefaultIs', { model: modelLabel(m.resolvedModel).name }) : t('newSession.modelDefault'));
const BRANCH_MODES = ['here', 'existing', 'new'];
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
/** Worktree of the tree that contains `dir` (the deepest one), or undefined. */
function worktreeOf(dir) {
  const c = pathKey(dir);
  return projects().flatMap(p => p.worktrees).filter(w => c === pathKey(w.path) || c.startsWith(pathKey(w.path) + '/')).sort((a, b) => b.path.length - a.path.length)[0];
}

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
        <span class="lbl">${t('newSession.branch')}</span>
        <div class="seg" id="branch-seg">${BRANCH_MODES.map(k => `<button type="button" data-bmode="${k}">${t(`newSession.branchMode.${k}`)}</button>`).join('')}</div>
        <div class="pane" data-pane="existing" hidden>
          <span class="suggest"><input id="pick-branch" placeholder="${esc(t('newSession.pickPlaceholder'))}" autocomplete="off" spellcheck="false"><span class="branch-list" hidden></span></span>
          <label class="check" id="switch-zone" hidden><input type="checkbox" id="switch-here"> ${t('newSession.switchHere')}</label>
        </div>
        <div class="pane row2" data-pane="new" hidden>
          <label>${t('newSession.newName')}<input id="new-branch" placeholder="${esc(t('newSession.branchPlaceholder'))}" autocomplete="off" spellcheck="false"></label>
          <label>${t('newSession.newBase')}<span class="suggest"><input id="base-branch" placeholder="${esc(t('newSession.basePlaceholder'))}" autocomplete="off" spellcheck="false"><span class="branch-list" hidden></span></span></label>
        </div>
        <span class="branch-target" id="branch-target"></span>
        <span class="branch-target warn" id="branch-warn" hidden></span>
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

  // Branch, three choices (git folders only): the folder as it is (default, back at each opening), an existing branch
  // (its worktree, a new one, or `git switch` in the folder) or a new branch with its own worktree, from a base.
  // The line under it says where the session will open.
  let branchList = [], bmode = 'here';
  const loadBranches = dir => {
    branchList = []; setMode('here', false);
    $('#start-branch-zone').hidden = true;
    if (!dir?.trim()) return;
    readBranches(dir).then(l => {
      if (pathKey($('#cwd')?.value) !== pathKey(dir)) return; // folder changed meanwhile
      branchList = l; $('#start-branch-zone').hidden = !l.length;
      $('#base-branch').value = bestBase()?.name || '';
      updateTarget();
    }).catch(() => {});
  };
  const targetOf = b => { const p = mainOf($('#cwd').value); return b && p ? `${p}-${b.replace(/[\\/:*?"<>|\s]+/g, '-')}` : ''; };
  const FIRST = ['main', 'master', 'develop', 'dev', 'trunk'];
  const firstRank = b => { const i = FIRST.indexOf(b.local); return i < 0 ? FIRST.length : i; };
  // Default base of a new branch: develop, otherwise main, master… (local before remote)
  const bestBase = () => branchList.filter(b => b.main).sort((a, b) => firstRank(a) - firstRank(b) || a.remote - b.remote || b.date - a.date)[0];
  const chosenBranch = () => { const n = $('#pick-branch').value.trim(); return branchList.find(b => b.name === n) || branchList.find(b => !b.remote && b.local === n) || null; };
  // Open sessions in the worktree of the folder: a switch changes their branch under them
  const openSessionsIn = dir => {
    const w = worktreeOf(dir), root = pathKey(w ? w.path : dir);
    return sessions().filter(s => s.status !== 'done' && s.cwd && (pathKey(s.cwd) === root || pathKey(s.cwd).startsWith(root + '/'))).length;
  };
  const code = s => `<b>${esc(s)}</b>`;
  const link = (label, attrs) => ` <button type="button" class="link" ${attrs}>${esc(label)}</button>`;
  const updateTarget = () => {
    const cwd = $('#cwd').value.trim(), pickIn = $('#pick-branch'), nameIn = $('#new-branch');
    let html = '', warning = '';
    pickIn.setCustomValidity(''); nameIn.setCustomValidity('');
    $('#switch-zone').hidden = true;
    if (bmode === 'here') {
      const w = worktreeOf(cwd), br = w?.branch || (w?.detached && w.head ? `⊘ ${w.head}` : '');
      html = br ? t('newSession.target.here', { path: code(cwd), branch: code(br) }) : t('newSession.target.hereNoBranch', { path: code(cwd) });
    } else if (bmode === 'existing') {
      const typed = pickIn.value.trim(), b = chosenBranch();
      if (typed && !b) {
        pickIn.setCustomValidity(t('newSession.pickFromList'));
        html = esc(t('newSession.unknownBranch', { branch: typed })) + link(t('newSession.createIt'), `data-go="new" data-name="${esc(typed)}"`);
      } else if (b?.worktree) html = t('newSession.target.itsWorktree', { path: code(b.worktree) });
      else if (b) {
        $('#switch-zone').hidden = false;
        if ($('#switch-here').checked) {
          html = t('newSession.target.switch', { path: code(cwd), branch: code(b.local) });
          const n = openSessionsIn(cwd);
          if (n) warning = t('newSession.switchWarning', { n });
        } else html = t('newSession.target.newWorktree', { path: code(targetOf(b.local)) }) + (b.remote ? t('newSession.target.tracks', { branch: code(b.local), remote: code(b.name) }) : '');
      }
      // A starting branch (develop, epic/…) is usually the base of a new one
      if (b?.main) html += `<br>${esc(t('newSession.mainBranchHint', { branch: b.name }))}${link(t('newSession.newFromIt'), `data-go="new" data-base="${esc(b.name)}"`)}`;
    } else {
      const name = nameIn.value.trim(), base = $('#base-branch').value.trim();
      if (name && branchList.some(b => !b.remote && b.local === name)) {
        nameIn.setCustomValidity(t('newSession.nameTaken', { branch: name }));
        html = esc(t('newSession.nameTaken', { branch: name })) + link(t('newSession.chooseIt'), `data-go="existing" data-pick="${esc(name)}"`);
      } else if (name) html = t('newSession.target.newBranch', { path: code(targetOf(name)), branch: code(name), base: base ? code(base) : esc(t('newSession.baseHead')) });
    }
    $('#branch-target').innerHTML = html;
    $('#branch-warn').textContent = warning; $('#branch-warn').hidden = !warning;
  };
  function setMode(k, focus = true) {
    bmode = k;
    document.querySelectorAll('#branch-seg [data-bmode]').forEach(b => b.classList.toggle('on', b.dataset.bmode === k));
    document.querySelectorAll('.start-branch [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== k; });
    $('#pick-branch').required = k === 'existing';
    $('#new-branch').required = k === 'new';
    if (focus && k !== 'here') $(k === 'existing' ? '#pick-branch' : '#new-branch').focus();
    updateTarget();
  }
  $('#branch-seg').addEventListener('click', e => { const b = e.target.closest('[data-bmode]'); if (b) setMode(b.dataset.bmode); });
  // Links of the target line: create the unknown branch, start from a main branch, pick the existing one
  $('#branch-target').addEventListener('click', e => {
    const a = e.target.closest('[data-go]');
    if (!a) return;
    if (a.dataset.base) $('#base-branch').value = a.dataset.base;
    if (a.dataset.name) $('#new-branch').value = a.dataset.name;
    if (a.dataset.pick) $('#pick-branch').value = a.dataset.pick;
    setMode(a.dataset.go, false);
    $(a.dataset.go === 'new' ? '#new-branch' : '#switch-here').focus();
  });
  // Suggestions (both inputs): main, master, develop… first, then epic/* and release/* (main ones), local, remote
  const suggest = input => {
    const z = input.nextElementSibling;
    let shown = [], active = -1;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const hit = branchList.filter(b => !q || b.name.toLowerCase().includes(q));
      const groupsOf = [
        ['main', hit.filter(b => b.main).sort((a, b) => firstRank(a) - firstRank(b) || b.date - a.date).slice(0, 15)],
        ['local', hit.filter(b => !b.main && !b.remote).slice(0, 30)],
        ['remote', hit.filter(b => !b.main && b.remote).slice(0, 20)],
      ].filter(([, l]) => l.length);
      shown = groupsOf.flatMap(([, l]) => l);
      active = Math.min(active, shown.length - 1);
      z.hidden = !shown.length;
      let i = 0;
      z.innerHTML = groupsOf.map(([g, l]) => `<div class="g">${t(`newSession.branchGroups.${g}`)}</div>`
        + l.map(b => `<div class="o ${i === active ? 'on' : ''}" data-i="${i++}"><span class="nm">${esc(b.name)}</span>`
          + `<span class="w">${b.worktree ? `⎇ ${esc(b.worktree.split(/[\\/]/).pop())}` : esc(timeAgo(new Date(b.date).toISOString()))}</span></div>`).join('')).join('');
      z.querySelectorAll('[data-i]').forEach(o => o.addEventListener('mousedown', e => { e.preventDefault(); pick(shown[+o.dataset.i]); }));
    };
    const close = () => { z.hidden = true; active = -1; };
    const pick = b => { input.value = b.name; close(); updateTarget(); };
    input.addEventListener('focus', render);
    input.addEventListener('blur', close);
    input.addEventListener('input', () => { active = -1; render(); updateTarget(); });
    input.addEventListener('keydown', e => {
      if (z.hidden) { if (e.key === 'ArrowDown') render(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length) {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        render();
      } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(shown[active]); }
      else if (e.key === 'Escape') close();
    });
  };
  suggest($('#pick-branch'));
  suggest($('#base-branch'));
  $('#new-branch').addEventListener('input', updateTarget);
  $('#switch-here').addEventListener('change', updateTarget);
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
    // Branch: its worktree, a new worktree on it (a remote one gets its local branch), a switch in the folder, or a
    // new branch from `base`
    let branch = '', base = '', switchHere = false;
    const zone = !$('#start-branch-zone').hidden;
    if (zone && bmode === 'existing') {
      const b = chosenBranch();
      if (b?.worktree) cwd = b.worktree;
      else if (b) { branch = b.local; base = b.remote ? b.name : ''; switchHere = $('#switch-here').checked; }
    } else if (zone && bmode === 'new') { branch = $('#new-branch').value.trim(); base = $('#base-branch').value.trim(); }
    showLoading(t('newSession.title'));
    try {
      // No first message: it opens ready, cursor in its input
      const { slug } = await create(cwd, mode, branch, model, '', base, switchHere);
      if (location.hash === before) location.hash = slug;
    } catch (err) { alert(err.message); if (location.hash === before) renderNewSession(cwd); }
  });
}
