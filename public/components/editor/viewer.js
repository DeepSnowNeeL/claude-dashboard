// Large window on a file: diff with the last commit (or as of a commit), or read-only.
import { detail, gitStatus, serverMode } from '../../core/state.js';
import { esc, skeleton } from '../../core/dom.js';
import { read, write } from '../../core/storage.js';
import { showInExplorer } from '../../services/desktop.js';
import { explorerState, loadExplorer, ensureOpenLoaded, absolute } from '../../services/explorer.js';
import { GIT_STATES, readDiff, readGitStatus } from '../../services/git.js';
import { isDarkTheme } from '../../services/theme.js';
import { filesHtml } from '../git-files.js';
import { loadMonaco, languageOf } from './monaco.js';
import { remarksOn } from './remark.js';
import { t } from '../../i18n/index.js';

/**
 * Large window on a file: side-by-side diff with its version from the last commit if it changed, otherwise
 * read-only. From the list of modified files, ← and → go to the previous or next file.
 * `options.files`: the git files of that list (modified, or those of commit `options.commit`), shown in a
 * panel next to the folder tree.
 */
export async function openViewer(path, list = null, index = 0, options = {}) {
  document.querySelector('.viewer')?.remove();
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="vis-head"><b class="vis-name"></b><span class="m vis-state"></span>
      <span class="vis-actions">
        ${list ? `<button class="btn" data-vis="prev" title="${t('editor.viewer.prevFile')}">←</button><span class="m vis-pos"></span><button class="btn" data-vis="next" title="${t('editor.viewer.nextFile')}">→</button>` : ''}
        <button class="btn" data-vis="mode" title="${t('editor.viewer.modeTitle')}">${t('editor.viewer.inline')}</button>
        ${serverMode() ? '' : '<button class="btn" data-vis="explorer">📂</button>'}
        <button class="btn" data-vis="close" title="${t('editor.viewer.close')}">✕</button>
      </span></div>
    <div class="vis-frame" data-tab="list">
      <div class="vis-tabs"><button class="tab" data-vis-tab="tree">${t('editor.viewer.folderTab')}</button><button class="tab" data-vis-tab="list">${t('editor.viewer.modifiedTab')}</button></div>
      <div class="vis-tree" hidden></div><div class="vis-body">${skeleton('code')}</div><div class="vis-list" hidden></div>
      <div class="vis-handle" data-handle="l" title="${t('editor.viewer.handle')}"></div><div class="vis-handle" data-handle="r" title="${t('editor.viewer.handle')}"></div>
    </div>`;
  document.body.append(v);
  let editor = null, sideBySide = true, currentPath = path, i = index;
  const frame = v.querySelector('.vis-frame');
  attachHandles(frame);

  // Modified files (or the commit's): on the right on a large screen, in a tab of the tree otherwise (grid of editor.css,
  // depending on the panels present)
  const listVis = v.querySelector('.vis-list');
  const layout = () => {
    frame.classList.toggle('with-tree', !treeVis.hidden);
    frame.classList.toggle('with-list', !listVis.hidden);
  };
  if (options.files?.length) {
    const n = options.files.length;
    listVis.innerHTML = `<div class="m vis-list-head">${options.commit ? t('editor.viewer.commitFiles') : t('editor.viewer.modifiedFiles')} · ${n}</div>`
      + `<div class="vis-scroll">${filesHtml(options.files, 'data-vis-list')}</div>`;
    listVis.hidden = false;
    v.querySelector('[data-vis-tab="list"]').textContent = t('editor.viewer.modifiedTabCount', { n });
  }
  listVis.addEventListener('click', e => {
    const b = e.target.closest('[data-vis-list]');
    if (b) { i = +b.dataset.i; show(list[i]); }
  });
  v.querySelector('.vis-tabs').addEventListener('click', e => {
    const o = e.target.closest('[data-vis-tab]')?.dataset.visTab;
    if (o) frame.dataset.tab = o;
  });

  // Tree on the left, centred on the open file: one click shows neighbouring files (as a diff if they
  // changed, marked by their state). Not for a commit diff, where today's tree would not tell the same story.
  const treeVis = v.querySelector('.vis-tree');
  const visOpen = new Set(explorerState.openDirs);
  const absKey = a => a.replace(/\//g, '\\').toLowerCase();
  async function paintTree(c, reveal = false) {
    if (options.commit || !detail()?.cwd) return;
    try { await loadExplorer(detail()); } catch { return; }
    const base = absKey(explorerState.dir.replace(/[\\/]+$/, '')) + '\\';
    if (!absKey(c).startsWith(base)) { treeVis.hidden = true; return layout(); } // file outside the session folder
    const rel = c.replace(/\\/g, '/').slice(base.length);
    // Its folders open when we land on the file, not on every paint: they can be folded afterwards
    if (reveal) rel.split('/').slice(0, -1).forEach((_, k, parts) => visOpen.add(rel.split('/').slice(0, k + 1).join('/')));
    await ensureOpenLoaded(visOpen);
    if (gitStatus().dir !== detail().cwd) { try { gitStatus.set({ dir: detail().cwd, ...(await readGitStatus(detail().cwd)) }); } catch { /* no marks */ } }
    const modified = new Map((gitStatus().files || []).map(f => [absKey(f.path), f.state]));
    const row = (r, name) => {
      const state = modified.get(absKey(absolute(r)));
      const [letter] = GIT_STATES[state] || [];
      return `<div class="ex-file ${r === rel ? 'sel' : ''} ${state ? `modified e-${state}` : ''}${explorerState.ignoredPaths.has(r) ? ' ignored' : ''}" data-file="${esc(r)}" title="${esc(r)}">${esc(name)}${letter ? `<span class="vis-letter">${letter}</span>` : ''}</div>`;
    };
    const render = (n, prefix = '') => [...n.dirs.keys()].sort((a, b) => a.localeCompare(b)).map(name => {
      let r = prefix + name, child = n.dirs.get(name), label = name;
      // Open folders with a single subfolder and no file: a single line (src/main/java/fr/…), like VS Code
      while (visOpen.has(r) && child.loaded && !child.files.size && child.dirs.size === 1) {
        const [next] = child.dirs.keys();
        label += `/${next}`; r += `/${next}`; child = child.dirs.get(next);
      }
      const open = visOpen.has(r), start = prefix + name;
      // A folder that contains a modified file says so, even folded
      const touched = [...modified.keys()].some(k => k.startsWith(absKey(absolute(start)) + '\\'));
      return `<div class="ex-folder ${touched ? 'touched' : ''}${child.ignored ? ' ignored' : ''}" data-folder="${esc(r)}" data-start="${esc(start)}" title="${esc(r)}"><span class="fl">${open ? '▾' : '▸'}</span> ${esc(label)}</div>
        ${open ? `<div class="ex-children">${child.loaded ? render(child, r + '/') : '<div class="m ex-empty">…</div>'}</div>` : ''}`;
    }).join('') + [...n.files].sort((a, b) => a.localeCompare(b)).map(name => row(prefix + name, name)).join('');
    const scroll = treeVis.scrollTop;
    treeVis.innerHTML = `<div class="vis-scroll">${render(explorerState.tree)}</div>`;
    treeVis.hidden = false;
    layout();
    treeVis.scrollTop = scroll;
    if (reveal) treeVis.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  treeVis.addEventListener('click', e => {
    const folder = e.target.closest('[data-folder]');
    if (folder) return toggleFolder(folder.dataset.folder, folder.dataset.start);
    const f = e.target.closest('[data-file]');
    if (f) show(absolute(f.dataset.file));
  });
  // Folding a chain closes all its folders; opening one goes down while it has a single subfolder (one line)
  async function toggleFolder(r, start) {
    if (visOpen.has(r)) {
      for (const o of [...visOpen]) if (o === start || o.startsWith(start + '/')) visOpen.delete(o);
      return paintTree(currentPath);
    }
    visOpen.add(r);
    for (let k = 0; k < 30; k++) {
      await ensureOpenLoaded(visOpen);
      const n = r.split('/').reduce((x, part) => x?.dirs.get(part), explorerState.tree);
      if (!n?.loaded || n.files.size || n.dirs.size !== 1) break;
      r += `/${[...n.dirs.keys()][0]}`;
      visOpen.add(r);
    }
    paintTree(currentPath);
  }
  // Files created or deleted while we look: the tree follows (explorer watching)
  const onUpdate = () => { if (!treeVis.hidden) paintTree(currentPath); };
  addEventListener('explorer-update', onUpdate);
  const close = () => { editor?.dispose(); v.remove(); removeEventListener('keydown', keyboard, true); removeEventListener('explorer-update', onUpdate); };
  const keyboard = e => {
    if (e.key === 'Escape' && v.querySelector('.remark-bubble')) return; // Escape closes the remark first
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    else if (list && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); go(e.key === 'ArrowLeft' ? -1 : 1); }
  };
  addEventListener('keydown', keyboard, true);
  const go = step => { if (!list) return; i = (i + step + list.length) % list.length; show(list[i]); };

  async function show(c) {
    currentPath = c;
    editor?.dispose(); editor = null;
    const body = v.querySelector('.vis-body');
    body.innerHTML = skeleton('code');
    v.querySelector('.vis-name').textContent = c;
    paintTree(c, true);
    if (list) {
      // Opened from the tree: move to this file if it is in the list
      const k = list.findIndex(x => absKey(x) === absKey(c));
      if (k >= 0) i = k;
      v.querySelector('.vis-pos').textContent = `${i + 1} / ${list.length}`;
      listVis.querySelectorAll('[data-vis-list]').forEach(b => b.classList.toggle('sel', k >= 0 && +b.dataset.i === k));
      listVis.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    let d, monaco;
    try { [d, monaco] = await Promise.all([readDiff(c, options.commit), loadMonaco()]); }
    catch (e) { body.innerHTML = `<p class="m">${esc(e.message)}</p>`; return; }
    if (currentPath !== c || !v.isConnected) return; // we moved to another file in the meantime
    // Diff of a commit ("as of then"): before the commit against what it left
    v.querySelector('.vis-state').textContent = options.commit
      ? `${options.title || options.commit} · ${d.binary ? t('editor.viewer.state.binary') : !d.exists ? t('editor.viewer.state.deletedByCommit') : !d.tracked ? t('editor.viewer.state.addedByCommit') : t('editor.viewer.state.modifiedByCommit')}`
      : d.binary ? t('editor.viewer.state.binary') : !d.root ? t('editor.viewer.state.notGit')
      : !d.exists ? t('editor.viewer.state.deleted') : !d.tracked ? t('editor.viewer.state.untracked') : d.modified ? t('editor.viewer.state.modified') : t('editor.viewer.state.unchanged');
    v.querySelector('[data-vis="mode"]').hidden = !d.modified;
    if (d.binary) { body.innerHTML = `<p class="m">${t('editor.viewer.binaryBody')}</p>`; return; }
    body.innerHTML = '';
    const dark = isDarkTheme();
    const common = { readOnly: true, automaticLayout: true, theme: dark ? 'vs-dark' : 'vs', minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12.5 };
    const lang = languageOf(c);
    if (d.modified) {
      // Unchanged parts are folded: we land on the changes (a click unfolds them)
      editor = monaco.editor.createDiffEditor(body, { ...common, renderSideBySide: sideBySide, originalEditable: false, hideUnchangedRegions: { enabled: true, contextLineCount: 3 } });
      editor.setModel({ original: monaco.editor.createModel(d.original, lang), modified: monaco.editor.createModel(d.current, lang) });
      remarksOn(v, editor.getOriginalEditor(), c, lang, options.commit ? t('editor.viewer.version.beforeCommit', { hash: options.commit.slice(0, 10) }) : t('editor.viewer.version.lastCommit'));
      remarksOn(v, editor.getModifiedEditor(), c, lang, options.commit ? t('editor.viewer.version.leftByCommit', { hash: options.commit.slice(0, 10) }) : null);
    } else {
      editor = monaco.editor.create(body, { ...common, value: d.current, language: lang });
      remarksOn(v, editor, c, lang, options.commit ? t('editor.viewer.version.commit', { hash: options.commit.slice(0, 10) }) : null);
    }
    // Opened from a search result: the found line centred, highlighted (without selecting it, which
    // would open the remark bubble)
    if (options.line) {
      const ed = editor.getModifiedEditor ? editor.getModifiedEditor() : editor;
      setTimeout(() => {
        ed.revealLineInCenter(options.line);
        ed.setPosition({ lineNumber: options.line, column: 1 });
        ed.deltaDecorations([], [{ range: new monaco.Range(options.line, 1, options.line, 1), options: { isWholeLine: true, className: 'found-line' } }]);
      }, 50);
    }
  }


  v.addEventListener('click', e => {
    const act = e.target.closest('[data-vis]')?.dataset.vis;
    if (act === 'close') close();
    else if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
    else if (act === 'mode' && editor?.updateOptions) {
      sideBySide = !sideBySide; editor.updateOptions({ renderSideBySide: sideBySide });
      e.target.textContent = sideBySide ? t('editor.viewer.inline') : t('editor.viewer.sideBySide');
    } else if (act === 'explorer') {
      if (window.desktop) window.desktop.showInExplorer(currentPath);
      else showInExplorer(currentPath).catch(err => alert(err.message));
    }
  });
  layout();
  show(path);
}

/**
 * Handles between the panels: "l" sets the width of the left panel (tree, or list alone), "r" that of
 * the right list. Widths kept in the browser, double-click to go back to the original one.
 */
function attachHandles(frame) {
  const widths = read('viewer-widths', {});
  const apply = () => {
    for (const [side, px] of Object.entries(widths)) frame.style.setProperty(`--vis-${side}`, `${px}px`);
  };
  apply();
  frame.querySelectorAll('[data-handle]').forEach(p => {
    const side = p.dataset.handle;
    p.addEventListener('pointerdown', e => {
      e.preventDefault();
      p.setPointerCapture(e.pointerId);
      const box = frame.getBoundingClientRect();
      frame.classList.add('resizing');
      const move = ev => {
        const px = side === 'l' ? ev.clientX - box.left : box.right - ev.clientX;
        widths[side] = Math.round(Math.max(140, Math.min(px, box.width * .6)));
        apply();
      };
      const finish = () => { frame.classList.remove('resizing'); p.removeEventListener('pointermove', move); write('viewer-widths', widths); };
      p.addEventListener('pointermove', move);
      p.addEventListener('lostpointercapture', finish, { once: true });
    });
    p.addEventListener('dblclick', () => { delete widths[side]; frame.style.removeProperty(`--vis-${side}`); write('viewer-widths', widths); });
  });
}
