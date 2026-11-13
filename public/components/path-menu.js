// Menu of a path clicked in the conversation (or right click in the explorer and the modified files): editor, tab,
// VS Code, Windows explorer, copy.
import { esc } from '../core/dom.js';
import { localFileUrl, pathExists, showInExplorer, openWithDefault, openInVsCode } from '../services/desktop.js';
import { openViewer } from './editor/viewer.js';
import { serverMode } from '../core/state.js';
import { t } from '../i18n/index.js';

const VIEWABLE = /\.(html?|pdf|png|jpe?g|gif|webp|svg|txt|md|log|json|jsonl|css|js|mjs|ts|java|scss|xml|ya?ml|sql|csv|properties|gradle|sh|ps1|py|vm)$/i;
// What Windows would run instead of opening it: no "Open with default app" (same list as server/routes/desktop.mjs)
const EXECUTABLES = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|lnk|pif|cpl|reg|jar|appref-ms)$/i;

/**
 * Real path of a link: as is if it exists; otherwise (relative to a subfolder), an absolute path already quoted in
 * the conversation that ends the same way ("my-skill/SKILL.md" → "E:\…\skills\my-skill\SKILL.md").
 */
async function resolvePath(a) {
  let r = await pathExists(a.dataset.path);
  if (r.exists || r.sensitive) return { path: a.dataset.path, ...r };
  const end = '\\' + a.textContent.replace(/:\d+(:\d+)?$/, '').replace(/^\.[\\/]/, '').replace(/\//g, '\\').toLowerCase();
  const candidates = [...new Set([...document.querySelectorAll('a.path')].map(x => x.dataset.path))]
    .filter(c => c.replace(/\//g, '\\').toLowerCase().endsWith(end));
  for (const c of candidates) { r = await pathExists(c); if (r.exists) return { path: c, ...r }; }
  return { path: a.dataset.path, exists: false };
}

export async function pathMenu(a, x, y) {
  document.querySelector('.path-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'path-menu';
  m.innerHTML = `<div class="m">${esc(a.dataset.path)}</div><div class="m">…</div>`;
  m.style.left = `${Math.min(x, innerWidth - 320)}px`;
  m.style.top = `${Math.min(y + 8, innerHeight - 130)}px`;
  document.body.append(m);
  const { path, exists, isDir, sensitive } = await resolvePath(a);
  if (!m.isConnected) return;
  const desktop = !serverMode(); // server mode: no default app, VS Code or explorer on the server
  m.innerHTML = `<div class="m">${esc(path)}</div>
    ${sensitive ? `<div class="m missing">${t('tree.pathMenu.sensitive')}</div>`
      : !exists ? `<div class="m missing">${t('tree.pathMenu.missing')}</div>` : ''}
    ${exists && !isDir && VIEWABLE.test(path) ? `<button data-act="tab"><span class="ic">↗</span>${t('tree.pathMenu.openInBrowser')}</button>` : ''}
    ${exists && !isDir ? `<button data-act="editor"><span class="ic">🔍</span>${t('tree.pathMenu.viewInEditor')}</button>` : ''}
    ${desktop && exists && !isDir && !EXECUTABLES.test(path) ? `<button data-act="default"><span class="ic">🗔</span>${t('tree.pathMenu.openWithDefault')}</button>` : ''}
    ${desktop && exists && !sensitive ? `<button data-act="vscode"><span class="ic">⌨</span>${t('tree.pathMenu.openInVsCode')}</button>` : ''}
    ${desktop && (exists || sensitive) ? `<button data-act="explorer"><span class="ic">📂</span>${t('tree.pathMenu.showInExplorer')}</button>` : ''}
    <button data-act="copy"><span class="ic">⧉</span>${t('tree.pathMenu.copyPath')}</button>`;
  m.addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    m.remove();
    // In the Electron app (window.desktop), the explorer and the browser open in the foreground
    if (act === 'editor') openViewer(path);
    else if (act === 'tab') {
      if (window.desktop) window.desktop.openExternal(location.origin + localFileUrl(path));
      else window.open(localFileUrl(path), '_blank');
    } else if (act === 'explorer') {
      if (window.desktop) window.desktop.showInExplorer(path);
      else await showInExplorer(path).catch(err => alert(err.message));
    } else if (act === 'vscode') {
      await openInVsCode(path).catch(err => alert(err.message));
    } else if (act === 'default') {
      const error = window.desktop?.openWithDefault ? await window.desktop.openWithDefault(path)
        : await openWithDefault(path).then(() => '').catch(err => err.message);
      if (error) alert(error);
    }
    else navigator.clipboard?.writeText(path);
  });
}

/** Click on a path in the text: the menu; click elsewhere or Escape: it closes. */
export function mountPathMenu() {
  document.addEventListener('click', e => {
    const a = e.target.closest('a.path');
    if (a) { e.preventDefault(); e.stopPropagation(); pathMenu(a, e.clientX, e.clientY); return; }
    if (!e.target.closest('.path-menu')) document.querySelector('.path-menu')?.remove();
  }, true);
  // Escape closes the menu without stopping the session (capture: runs before the Stop shortcut)
  addEventListener('keydown', e => {
    const m = document.querySelector('.path-menu');
    if (e.key === 'Escape' && m) { m.remove(); e.stopPropagation(); e.preventDefault(); }
  }, true);
}
