// /mcp window: MCP servers of the session.
import { esc, toast, skeleton } from '../core/dom.js';
import { readMcp, mcpAction } from '../services/sessions.js';
import { openMcpAuth } from '../services/commands.js';
import { t } from '../i18n/index.js';
import { serverMode } from '../core/state.js';

/** /mcp: MCP servers of the session, like in Claude Code (state, tools, reconnect, enable, authenticate). */
const MCP_STATES = { connected: ['✓', 'connected', 'ok'], failed: ['✗', 'failed', 'ko'], 'needs-auth': ['🔑', 'needsAuth', 'auth'], pending: ['⏳', 'pending', 'pending'], disabled: ['○', 'disabled', 'off'] };
const stateLabel = status => (MCP_STATES[status] ? t(`mcp.states.${MCP_STATES[status][1]}`) : status);
export async function openMcp(d) {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal mcp-view" role="dialog"><button class="close-x" title="${t('common.closeEsc')}">×</button>
    <h3>${t('mcp.title')} <span class="m">· ${esc(d.title || d.slug)}</span></h3>
    <input type="search" class="mcp-search" placeholder="${t('mcp.searchPlaceholder')}" autocomplete="off" spellcheck="false">
    <div class="mcp-list">${skeleton('lines', 5)}</div></div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    // Escape first clears the search, then closes
    if (e.target === field && field.value) { field.value = ''; paint(); } else close();
  });
  backdrop.querySelector('.close-x').onclick = close;
  document.body.append(backdrop);
  const z = backdrop.querySelector('.mcp-list');
  const field = backdrop.querySelector('.mcp-search');
  field.addEventListener('input', () => paint());
  setTimeout(() => field.focus());
  let last = null; // last list read, filtered again at every keystroke
  const notes = new Map(); // server → message shown in its block (instead of an alert)
  // Search: a server whose name matches keeps all its tools; otherwise only its matching tools
  // remain, expanded, the match highlighted. Case and accent insensitive.
  const flat = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const highlight = (s, q) => {
    const i = q ? flat(s).indexOf(q) : -1;
    return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
  };
  const paint = servers => {
    if (servers) last = servers;
    if (!last) return;
    if (!last.length) { z.innerHTML = `<p class="m">${t('mcp.noServer')}</p>`; return; }
    const q = flat(field.value.trim());
    const shown = [...last].sort((a, b) => a.name.localeCompare(b.name)).map(sv => {
      if (!q || flat(sv.name).includes(q)) return { sv, tools: sv.tools, open: false };
      const tools = sv.tools.filter(o => flat(o).includes(q));
      return tools.length ? { sv, tools, open: true } : null;
    }).filter(Boolean);
    if (!shown.length) { z.innerHTML = `<p class="m">${t('mcp.noMatch', { q: esc(field.value.trim()) })}</p>`; return; }
    z.innerHTML = shown.map(({ sv, tools, open }) => {
      const [ic, , cls] = MCP_STATES[sv.status] || ['?', '', ''];
      const internal = sv.name === 'dashboard'; // the tool of the right panel: not to be touched
      return `<div class="mcp-srv e-${cls}">
        <div class="mcp-head"><b>${highlight(sv.name, q)}</b> <span class="pill-mcp">${ic} ${esc(stateLabel(sv.status))}</span>
          <span class="m">${[sv.scope, sv.version && `v${sv.version}`].filter(Boolean).map(esc).join(' · ')}</span></div>
        ${sv.error ? `<div class="mcp-err">${esc(sv.error)}</div>` : ''}
        ${sv.status === 'needs-auth' ? `<div class="m">${t(serverMode() ? 'mcp.authHelpServer' : 'mcp.authHelp', { name: esc(sv.name) })}</div>` : ''}
        ${notes.has(sv.name) ? `<div class="mcp-note">${esc(notes.get(sv.name))}</div>` : ''}
        ${tools.length ? `<details${open ? ' open' : ''}><summary class="m">${tools.length < sv.tools.length ? t('mcp.toolsOf', { k: tools.length, n: sv.tools.length }) : t('mcp.tools', { n: sv.tools.length })}</summary><div class="mcp-tools">${tools.map(o => `<code>${highlight(o, q)}</code>`).join(' ')}</div></details>` : ''}
        ${internal ? '' : `<div class="mcp-actions">
          ${!serverMode() && (sv.status === 'needs-auth' || sv.status === 'failed') ? `<button class="btn" data-mcp-auth="${esc(sv.name)}" title="${t('mcp.authenticateTitle')}">${t('mcp.authenticate')}</button>` : ''}
          ${sv.status !== 'disabled' ? `<button class="btn" data-mcp="reconnect" data-name="${esc(sv.name)}">${t('mcp.reconnect')}</button>` : ''}
          <button class="btn" data-mcp="toggle" data-name="${esc(sv.name)}" data-active="${sv.status === 'disabled' ? 1 : 0}">${sv.status === 'disabled' ? t('mcp.enable') : t('mcp.disable')}</button>
        </div>`}
      </div>`;
    }).join('');
  };
  const load = async () => {
    try { paint(await readMcp(d.slug)); } catch (e) { z.innerHTML = `<p class="m">${esc(e.message)}</p>`; }
  };
  z.addEventListener('click', async e => {
    const b = e.target.closest('[data-mcp], [data-mcp-auth]');
    if (!b) return;
    if (b.dataset.mcpAuth) {
      try { await openMcpAuth(d.cwd); toast(t('mcp.terminalOpened', { name: b.dataset.mcpAuth })); } catch (err) { alert(err.message); }
      return;
    }
    const name = b.dataset.name;
    b.disabled = true;
    b.textContent = b.dataset.mcp === 'reconnect' ? t('mcp.reconnecting') : '…';
    try {
      const servers = await mcpAction(d.slug, b.dataset.mcp, name, b.dataset.active === '1');
      const after = servers.find(x => x.name === name);
      if (b.dataset.mcp === 'reconnect') notes.set(name, after?.status === 'connected' ? t('mcp.reconnected') : after?.status === 'needs-auth' ? t('mcp.stillNotAuthenticated') : t('mcp.reconnection', { state: stateLabel(after?.status) }));
      paint(servers);
    } catch (err) {
      // Reconnection failed (unreachable server, not authenticated…): said in the server block, not as an alert
      notes.set(name, /needs-auth/.test(err.message) ? t('mcp.stillNotAuthenticated') : err.message);
      load();
    }
  });
  load();
}
