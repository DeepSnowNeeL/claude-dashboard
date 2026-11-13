// Ctrl+P: find a file of the folder by its name (fuzzy search, services/explorer.js).
import { detail, sideTab } from '../../core/state.js';
import { $, esc, skeleton } from '../../core/dom.js';
import { write } from '../../core/storage.js';
import { explorerState, loadExplorer, absolute, fuzzyScore } from '../../services/explorer.js';
import { openViewer } from '../editor/viewer.js';
import { t } from '../../i18n/index.js';

export async function filePalette() {
  if (!detail()?.cwd) return;
  document.querySelector('.palette-backdrop')?.remove();
  const p = document.createElement('div');
  p.className = 'palette-backdrop';
  p.innerHTML = `<div class="palette"><input placeholder="${t('explorer.palette.placeholder')}" autocomplete="off"><div class="palette-list"></div></div>`;
  document.body.append(p);
  const field = p.querySelector('input'), lst = p.querySelector('.palette-list');
  let found = [], i = 0;
  const close = () => p.remove();
  const paint = () => {
    lst.innerHTML = found.map((rel, k) => `<div class="palette-item ${k === i ? 'on' : ''}" data-k="${k}"><b>${esc(rel.split('/').pop())}</b> <span class="m">${esc(rel.slice(0, -rel.split('/').pop().length))}</span></div>`).join('')
      || (explorerState.files.length ? `<p class="m">${t('explorer.palette.none')}</p>` : skeleton('lines', 5));
    lst.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const filter = () => {
    const q = field.value.trim().toLowerCase().replace(/\s+/g, '');
    found = !q ? explorerState.files.slice(0, 50)
      : explorerState.files.map(rel => [rel, fuzzyScore(q, rel)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([rel]) => rel);
    i = 0; paint();
  };
  const choose = rel => {
    close();
    if (!rel) return;
    if (sideTab() !== 'explorer') { sideTab.set('explorer'); write('dash-side-tab', 'explorer'); $('#explorer')?.remove(); }
    setTimeout(() => { dispatchEvent(new CustomEvent('explorer-reveal', { detail: rel })); openViewer(absolute(rel)); }, 0);
  };
  field.addEventListener('input', filter);
  field.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); i = Math.min(i + 1, found.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(i - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(found[i]); }
  });
  lst.addEventListener('click', e => { const it = e.target.closest('[data-k]'); if (it) choose(found[+it.dataset.k]); });
  p.addEventListener('mousedown', e => { if (e.target === p) close(); });
  field.focus();
  filter();
  try { await loadExplorer(detail()); filter(); } catch { /* stays empty */ }
}

/** Ctrl+P, or the ⌕ button of the explorer ("open-palette" event), opens the palette. */
export function mountPalette() {
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p' && detail()?.cwd) { e.preventDefault(); filePalette(); }
  }, true);
  addEventListener('open-palette', () => filePalette());
}
