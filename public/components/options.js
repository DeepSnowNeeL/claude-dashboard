// ⚙ Options window (one tab per topic) and bottom of the list: remote access, from the PC only.
// From the internet (https), the bottom of the list only offers to log out.
import { $, esc, toast, formatWhen } from '../core/dom.js';
import { readOptions, saveOptions } from '../services/options.js';
import { loadList } from '../services/projects.js';
import { readTheme, setTheme } from '../services/theme.js';
import { accessState, readAccess, approveDevice, revokeDevice, logOut, saveAccess } from '../services/access.js';
import { resetMermaid } from './mermaid.js';
import { rerenderSide } from './side/tabs.js';
import { t } from '../i18n/index.js';
import { serverMode } from '../core/state.js';

async function loadAccess() {
  const z = $('#access-footer');
  // Outside the PC (internet, wifi): Options reduced to the theme; from the internet, a way to log out
  const outsidePc = () => {
    if (z.querySelector('#options-open')) return;
    z.innerHTML = `<button class="btn options-btn" id="options-open">⚙ ${t('options.title')}</button>${location.protocol === 'https:' ? `<button class="link access-logout" id="access-logout">${t('options.logOutDevice')}</button>` : ''}`;
    z.querySelector('#options-open').onclick = () => openOptions('general');
    z.querySelector('#access-logout')?.addEventListener('click', async () => { await logOut(); location.replace('/'); });
  };
  // Server mode: an approved device manages access like the PC (approves the next ones), and can log out
  if (location.protocol === 'https:' && !serverMode()) return outsidePc();
  if (!await readAccess()) return outsidePc(); // wifi: no management
  const pending = accessState().devices.filter(a => !a.approved).length;
  z.innerHTML = `<button class="btn options-btn" id="options-open">⚙ ${t('options.title')}${pending ? `<b class="access-pending" title="${t('options.pendingTitle')}">🔒 ${t('options.pending', { n: pending })}</b>` : ''}</button>`
    + (serverMode() ? `<button class="link access-logout" id="access-logout">${t('options.logOutDevice')}</button>` : '');
  z.querySelector('#options-open').onclick = () => openOptions(pending ? 'access' : 'general');
  z.querySelector('#access-logout')?.addEventListener('click', async () => { await logOut(); location.replace('/'); });
  if ($('#access-modal')) renderAccessModal();
}

// --- Theme: the computer's one, or forced (localStorage, set before display by index.html) -----------------
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(th) {
  setTheme(th);
  resetMermaid(); // the diagrams redraw with the right theme (Monaco takes it at the next opening)
  rerenderSide();
}

// --- Language of the interface: setting of the PC (options.json), `auto` follows the browser ----------------------
const LANGUAGES = ['auto', 'fr', 'en'];

// --- Options window: one tab per topic (from the PC only) ---------------------------------------------
const OPTION_TABS = ['general', 'access'];
// Claude Code auto-compact: threshold (window size taken into account), applied at the next start of each session
// (Claude Code compacts at the window minus ≈ 33k of margin for the summary: 300k → 267k)
const autoCompactChoices = () => [['default', t('options.autoCompact.default')],
  ...[200, 300, 400, 500, 700].map(k => [String(k * 1000), t('options.autoCompact.at', { at: k - 33, window: k })]), ['off', t('options.autoCompact.off')]];
const ARCHIVE_DELAYS = [0, 1, 3, 7, 30];
export async function openOptions(tab = 'general') {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal options" role="dialog">
    <button class="close-x" title="${t('common.closeEsc')}">×</button><h3>⚙ ${t('options.title')}</h3>
    <div class="options-tabs">${OPTION_TABS.filter(k => k === 'general' || accessState()).map(k => `<button class="tab-opt" data-tab="${k}">${t(`options.tabs.${k}`)}</button>`).join('')}</div>
    <div class="options-body"></div>
  </div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  backdrop.querySelector('.close-x').onclick = close;
  document.body.append(backdrop);
  const body = backdrop.querySelector('.options-body');
  const show = async k => {
    backdrop.querySelectorAll('.tab-opt').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'access') {
      body.innerHTML = '<div class="access" id="access-modal"></div>';
      renderAccessModal(true);
      loadAccess();
      return;
    }
    const o = await readOptions().catch(() => null); // null outside the PC: only the theme
    const theme = readTheme();
    body.innerHTML = `<label>${t('options.theme.label')}
        <select id="opt-theme">${THEMES.map(k => `<option value="${k}" ${theme === k ? 'selected' : ''}>${t(`options.theme.${k}`)}</option>`).join('')}</select></label>
      <div class="m">${t('options.theme.help')}</div>
      ${o ? `<label>${t('options.language.label')}
        <select id="opt-language">${LANGUAGES.map(k => `<option value="${k}" ${(o.language || 'auto') === k ? 'selected' : ''}>${t(`options.language.${k}`)}</option>`).join('')}</select></label>
      <div class="m">${t('options.language.help')}</div>
      <label>${t('options.archive.label')}
        <select id="opt-archiving">${ARCHIVE_DELAYS.map(j => `<option value="${j}" ${Number(o.archiveAfterDays) === j ? 'selected' : ''}>${t(`options.archive.delays.d${j}`)}</option>`).join('')}</select></label>
      <div class="m">${t('options.archive.help')}</div>
      <label>${t('options.autoCompact.label')}
        <select id="opt-compact">${autoCompactChoices().map(([v, lbl]) => `<option value="${v}" ${String(o.autoCompact ?? 'default') === v ? 'selected' : ''}>${lbl}</option>`).join('')}</select></label>
      <div class="m">${t('options.autoCompact.help')}</div>` : ''}`;
    body.querySelector('#opt-theme').onchange = e => applyTheme(e.target.value);
    // New language: the page reloads, simplest way to redraw everything in it
    if (body.querySelector('#opt-language')) body.querySelector('#opt-language').onchange = async e => {
      try { await saveOptions({ language: e.target.value }); location.reload(); } catch (err) { alert(err.message); }
    };
    if (body.querySelector('#opt-compact')) body.querySelector('#opt-compact').onchange = async e => {
      try { await saveOptions({ autoCompact: e.target.value }); toast(t('options.savedNextStart')); } catch (err) { alert(err.message); }
    };
    if (body.querySelector('#opt-archiving')) body.querySelector('#opt-archiving').onchange = async e => {
      try { await saveOptions({ archiveAfterDays: Number(e.target.value) }); toast(t('options.saved')); loadList(); } catch (err) { alert(err.message); }
    };
  };
  backdrop.querySelectorAll('.tab-opt').forEach(b => b.onclick = () => show(b.dataset.tab));
  show(tab);
}
window.openRemoteAccess = () => openOptions('access'); // "New device" notification of the application
/** @param {boolean} [all] false: only the state and the device list are redrawn (the input in progress stays) */
function renderAccessModal(all = false) {
  const state = accessState();
  const m = $('#access-modal');
  if (!m || !state) return;
  const { domain, password, devices, caddy, exe } = state;
  const server = !!state.serverMode; // server mode: no domain, Caddy or relay (the reverse proxy is the user's)
  // Approval code shown on the device's waiting screen (server mode), to recognise it
  const code = a => (server && a.code ? ` <code class="device-code">${esc(a.code)}</code>` : '');
  const line = a => `<div class="device${a.approved ? '' : ' pending'}">
    <div><b>${esc(a.name)}</b>${code(a)} <span class="m">${esc(a.ip)}</span><div class="m">${a.approved ? esc(t('options.access.seen', { when: formatWhen(a.seen) })) : esc(t('options.access.requested', { when: formatWhen(a.created) }))}</div></div>
    <span>${a.approved ? '' : `<button class="btn on" data-approve="${esc(a.id)}">${t('options.access.approve')}</button> `}<button class="btn" data-revoke="${esc(a.id)}">${a.approved ? t('options.access.revoke') : t('options.access.refuse')}</button></span>
  </div>`;
  const full = all || !m.querySelector('#ac-devices');
  // Server mode: changing the password from a device asks for the current one (a stolen device cannot lock you out)
  if (full && server) m.innerHTML = `<div class="m" id="ac-state"></div>
    ${password ? `<label>${t('options.access.currentPassword')}<input id="ac-cur" type="password" autocomplete="current-password"></label>` : ''}
    <label>${password ? t('options.access.changePassword') : t('options.access.masterPassword')}
      <input id="ac-pwd" type="password" autocomplete="new-password"></label>
    <input id="ac-pwd2" type="password" autocomplete="new-password" placeholder="${t('options.access.confirm')}">
    <div class="ed-label">${t('options.access.devices')}</div>
    <div id="ac-devices"></div>
    <div class="bar"><span></span><span><button class="btn on" id="ac-ok">${t('options.access.save')}</button></span></div>`;
  else if (full) m.innerHTML = `<div class="m" id="ac-state"></div>
    <label>${t('options.access.domain')}<input id="ac-domain" value="${esc(domain)}" placeholder="${t('options.access.domainPlaceholder')}"></label>
    <label>${password ? t('options.access.changePassword') : t('options.access.masterPassword')}
      <input id="ac-pwd" type="password" autocomplete="new-password"></label>
    <input id="ac-pwd2" type="password" autocomplete="new-password" placeholder="${t('options.access.confirm')}">
    <div class="ed-label">${t('options.access.devices')}</div>
    <div id="ac-devices"></div>
    <div class="ed-label">${t('options.access.severalPcs')}</div>
    <div class="m">${t('options.access.severalPcsHelp')}</div>
    <label>${t('options.access.relaysLabel')} <span class="m">${t('options.access.relaysHint')}</span>
      <textarea id="ac-relays" rows="2" placeholder="${t('options.access.relaysPlaceholder')}">${esc((state.relays || []).map(r => `${r.domain} ${r.target}`).join('\n'))}</textarea></label>
    <label>${t('options.access.viaLabel')} <span class="m">${t('options.access.viaHint')}</span>
      <input id="ac-via" value="${esc(state.viaRelay || '')}" placeholder="10.0.0.10"></label>
    <label class="check-row"><input type="checkbox" id="ac-port80" ${state.httpPort === 80 ? 'checked' : ''}> ${t('options.access.standalone')}
      <span class="m">${t('options.access.standaloneHint')}</span></label>
    <div class="bar"><span></span><span><button class="btn on" id="ac-ok">${t('options.access.save')}</button></span></div>`;
  if (server) m.querySelector('#ac-state').innerHTML = t('options.access.serverMode');
  else m.querySelector('#ac-state').innerHTML = `${t('options.access.fromInternet', { domain: esc(domain || t('options.access.domainWord')) })}${state.viaRelay ? ` ${t('options.access.viaRelay', { ip: esc(state.viaRelay) })}` : ''}
    ${!exe ? `<br>${t('options.access.caddyMissing')}` : domain && password ? (caddy ? `<br>${t('options.access.caddyRunning')}` : `<br>${t('options.access.caddyNotRunning')}`) : ''}`;
  const list = m.querySelector('#ac-devices');
  list.innerHTML = devices.length ? [...devices].sort((a, b) => a.approved - b.approved).map(line).join('') : `<div class="m">${t('options.access.noDevice')}</div>`;
  list.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => { await approveDevice(b.dataset.approve); toast(t('options.access.deviceApproved')); loadAccess(); });
  list.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    await revokeDevice(b.dataset.revoke); loadAccess();
  });
  if (!full) return;
  m.querySelector('#ac-ok').onclick = async () => {
    const pwd = m.querySelector('#ac-pwd').value, pwd2 = m.querySelector('#ac-pwd2').value;
    if (server) {
      try { await saveAccess({ pwd, pwd2, current: m.querySelector('#ac-cur')?.value || '' }); toast(t('options.access.saved')); await loadAccess(); renderAccessModal(true); } catch (e) { alert(e.message); }
      return;
    }
    const dom = m.querySelector('#ac-domain').value.trim();
    try {
      const relays = m.querySelector('#ac-relays').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [d, c] = l.split(/\s+/); return { domain: d, target: c }; });
      await saveAccess({ pwd, pwd2, dom, relays, via: m.querySelector('#ac-via').value.trim(), port80: m.querySelector('#ac-port80').checked });
      toast(t('options.access.saved'));
      await loadAccess();
      renderAccessModal(true);
    } catch (e) { alert(e.message); }
  };
}
/** The bottom of the list (⚙ Options, pending devices): read at startup then every 10 s. */
export function mountOptions() {
  loadAccess();
  setInterval(loadAccess, 10000);
}
