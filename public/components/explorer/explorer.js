// "Explorer" tab of the right panel: all the files of the session folder, text search, Ctrl+P.
// A click opens the file in Monaco (remarks on selection included). Folders are only drawn when open:
// a repository of 10,000 files stays instant.
import { detail } from '../../core/state.js';
import { $, esc, skeleton } from '../../core/dom.js';
import { explorerState, loadExplorer, ensureOpenLoaded, absolute, searchText } from '../../services/explorer.js';
import { openViewer } from '../editor/viewer.js';
import { pathMenu } from '../path-menu.js';
import { t } from '../../i18n/index.js';

// Windows reports a change in the folder (services/explorer.js): the displayed tree repaints.
addEventListener('explorer-update', () => { if (detail()?.cwd === explorerState.dir) paintExplorer(detail()); });
// Ctrl+P (palette.js) picks a file: it is unfolded and selected in the tree.
addEventListener('explorer-reveal', e => reveal(e.detail));

function treeHtml(n, prefix = '') {
  const dirs = [...n.dirs.keys()].sort((a, b) => a.localeCompare(b));
  return dirs.map(name => {
    let rel = prefix + name, child = n.dirs.get(name), label = name;
    // Open folders with a single subfolder and no file: a single line (src/main/java/fr/…), like VS Code
    while (explorerState.openDirs.has(rel) && child.loaded && !child.files.size && child.dirs.size === 1) {
      const [next] = child.dirs.keys();
      label += `/${next}`; rel += `/${next}`; child = child.dirs.get(next);
    }
    const open = explorerState.openDirs.has(rel);
    const content = !open ? '' : child.loaded ? treeHtml(child, rel + '/') || `<div class="m ex-empty">${t('explorer.empty')}</div>` : '<div class="m ex-empty">…</div>';
    return `<div class="ex-folder${child.ignored ? ' ignored' : ''}" data-folder="${esc(rel)}" data-start="${esc(prefix + name)}" title="${esc(rel)}${child.ignored ? ` · ${t('explorer.ignoredByGit')}` : ''}"><span class="fl">${open ? '▾' : '▸'}</span> ${esc(label)}</div>
      ${open ? `<div class="ex-children">${content}</div>` : ''}`;
  }).join('') + [...n.files].sort((a, b) => a.localeCompare(b)).map(name => {
    const rel = prefix + name;
    return `<div class="ex-file ${explorerState.selection === rel ? 'sel' : ''}${explorerState.ignoredPaths.has(rel) ? ' ignored' : ''}" data-file="${esc(rel)}"${explorerState.ignoredPaths.has(rel) ? ` title="${t('explorer.ignoredByGit')}"` : ''}>${esc(name)}</div>`;
  }).join('');
}

function paintExplorer(d) {
  const body = $('#ex-body');
  if (!body || detail()?.slug !== d.slug) return;
  const scroll = body.scrollTop;
  if (explorerState.results && explorerState.q) {
    const r = explorerState.results;
    const byFile = new Map();
    for (const x of r.results) (byFile.get(x.rel) || byFile.set(x.rel, []).get(x.rel)).push(x);
    const highlight = s => {
      if (explorerState.regex) { try { return esc(s).replace(new RegExp(explorerState.q.replace(/[<>&]/g, ''), explorerState.matchCase ? 'g' : 'gi'), m => `<mark>${m}</mark>`); } catch { return esc(s); } }
      const i = explorerState.matchCase ? s.indexOf(explorerState.q) : s.toLowerCase().indexOf(explorerState.q.toLowerCase());
      return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + explorerState.q.length))}</mark>${esc(s.slice(i + explorerState.q.length))}`;
    };
    body.innerHTML = `<div class="m ex-summary">${t('explorer.searchSummary', { n: r.results.length, more: r.truncated ? '+' : '', files: byFile.size })} · ${r.ms} ms · ${esc(r.tool || '')}</div>`
      + [...byFile].map(([rel, lines]) => `<div class="ex-res">
          <div class="ex-res-file" data-file="${esc(rel)}"><b>${esc(rel.split('/').pop())}</b> <span class="m">${esc(rel.slice(0, -rel.split('/').pop().length))}</span> <span class="count">${lines.length}</span></div>
          ${lines.map(x => `<div class="ex-res-line" data-file="${esc(rel)}" data-line="${x.line}"><span class="no">${x.line}</span>${highlight(x.text.trim())}</div>`).join('')}
        </div>`).join('') || `<p class="m">${t('explorer.noResults')}</p>`;
  } else {
    const html = explorerState.tree && treeHtml(explorerState.tree);
    body.innerHTML = html ? `<div class="ex-scroll">${html}</div>` : explorerState.tree ? `<p class="m">${t('explorer.emptyFolder')}</p>` : skeleton('lines', 8);
  }
  body.scrollTop = scroll;
}

export async function renderExplorer(d, bar) {
  // Already shown for this session: no repaint on every update (the search field keeps the focus)
  if ($('#explorer')?.dataset.slug === d.slug) return;
  $('#right').classList.add('mode-git');
  $('#right').innerHTML = bar + `<div id="explorer" data-slug="${esc(d.slug)}">
    <div class="ex-bar">
      <input id="ex-search" placeholder="${t('explorer.searchPlaceholder')}" value="${esc(explorerState.dir === d.cwd ? explorerState.q : '')}" autocomplete="off">
      <button class="ex-opt ${explorerState.matchCase ? 'on' : ''}" data-ex-opt="matchCase" title="${t('explorer.matchCase')}">Aa</button>
      <button class="ex-opt ${explorerState.regex ? 'on' : ''}" data-ex-opt="regex" title="${t('explorer.regex')}">.*</button>
      <button class="ex-opt" data-ex="palette" title="${t('explorer.findFile')}">⌕</button>
      <button class="ex-opt" data-ex="collapse" title="${t('explorer.collapseAll')}">⊟</button>
    </div>
    <div class="ex-body" id="ex-body"></div>
  </div>`;
  const body = $('#ex-body');
  body.addEventListener('click', async e => {
    const folder = e.target.closest('[data-folder]');
    if (folder) {
      let rel = folder.dataset.folder;
      // Folding a chain closes all its folders
      if (explorerState.openDirs.has(rel)) {
        const start = folder.dataset.start;
        for (const o of [...explorerState.openDirs]) if (o === start || o.startsWith(start + '/')) explorerState.openDirs.delete(o);
        return paintExplorer(d);
      }
      explorerState.openDirs.add(rel);
      paintExplorer(d); // "…" while the folder is read from disk
      // Go down while there is a single subfolder: the chain shows open, on one line
      for (let k = 0; k < 30; k++) {
        await ensureOpenLoaded();
        const n = rel.split('/').reduce((x, part) => x?.dirs.get(part), explorerState.tree);
        if (!n?.loaded || n.files.size || n.dirs.size !== 1) break;
        rel += `/${[...n.dirs.keys()][0]}`;
        explorerState.openDirs.add(rel);
      }
      return paintExplorer(d);
    }
    const f = e.target.closest('[data-file]');
    if (!f) return;
    explorerState.selection = f.dataset.file;
    body.querySelectorAll('.ex-file.sel').forEach(x => x.classList.remove('sel'));
    f.classList.add('sel');
    openViewer(absolute(f.dataset.file), null, 0, f.dataset.line ? { line: +f.dataset.line } : {});
  });
  // Right click: the chat path menu (editor, tab, Windows explorer, copy path)
  body.addEventListener('contextmenu', e => {
    const el = e.target.closest('[data-file], [data-folder]');
    if (!el) return;
    e.preventDefault();
    const rel = el.dataset.file || el.dataset.folder;
    pathMenu({ dataset: { path: absolute(rel) }, textContent: '' }, e.clientX, e.clientY);
  });
  let pending = null;
  const search = async () => {
    explorerState.q = $('#ex-search').value.trim();
    if (explorerState.q.length < 2) { explorerState.results = null; return paintExplorer(d); }
    const q = explorerState.q;
    const r = await searchText(d.cwd, q, explorerState.regex, explorerState.matchCase).catch(e => ({ results: [], error: e.message }));
    if (q !== explorerState.q) return; // a more recent keystroke took over
    explorerState.results = r;
    paintExplorer(d);
  };
  $('#ex-search').addEventListener('input', () => { clearTimeout(pending); pending = setTimeout(search, 250); });
  $('#ex-search').addEventListener('keydown', e => { if (e.key === 'Escape' && $('#ex-search').value) { e.stopPropagation(); $('#ex-search').value = ''; search(); } });
  $('#explorer').querySelectorAll('[data-ex-opt]').forEach(b => b.addEventListener('click', () => {
    explorerState[b.dataset.exOpt] = !explorerState[b.dataset.exOpt];
    b.classList.toggle('on', explorerState[b.dataset.exOpt]);
    search();
  }));
  $('#explorer').querySelector('[data-ex="collapse"]').addEventListener('click', () => { explorerState.openDirs.clear(); paintExplorer(d); });
  $('#explorer').querySelector('[data-ex="palette"]').addEventListener('click', () => dispatchEvent(new Event('open-palette')));
  paintExplorer(d);
  try { await loadExplorer(d); } catch (e) { body.innerHTML = `<p class="m">${esc(e.message)}</p>`; return; }
  paintExplorer(d);
  if (explorerState.q.length >= 2 && !explorerState.results) search();
}

/** Selects a file in the tree: parent folders unfolded, row visible and highlighted. */
async function reveal(rel) {
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) explorerState.openDirs.add(parts.slice(0, i).join('/'));
  explorerState.selection = rel;
  explorerState.q = ''; explorerState.results = null;
  if ($('#ex-search')) $('#ex-search').value = '';
  await ensureOpenLoaded();
  paintExplorer(detail());
  requestAnimationFrame(() => document.querySelector(`#ex-body [data-file="${CSS.escape(rel)}"]`)?.scrollIntoView({ block: 'center' }));
}
