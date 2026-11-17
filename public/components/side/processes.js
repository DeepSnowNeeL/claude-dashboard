// "Processes" tab of the right panel (PC only): what runs on the PC for development and who launched it, read
// from the engine (engine/processes.mjs). Five collapsible sections: sessions of the displayed session's project,
// sessions of other projects, editors and terminals, orphans in the projects, unknown origin. Stop kills the tree
// after an inline confirmation.
import { signal } from '../../core/signals.js';
import { detail, sideTab, sessions } from '../../core/state.js';
import { $, esc, skeleton } from '../../core/dom.js';
import { read, write } from '../../core/storage.js';
import { readProcesses, killProcess, onPc } from '../../services/processes.js';
import { t, locale } from '../../i18n/index.js';

/** Last reading: { items, total, projects } (null before the first one), or { error }. */
export const processes = signal(null);

const collapsed = new Set(read('dash-processes-collapsed', []));
const expanded = new Set(); // pid:created of the opened lines
let confirming = null;      // pid:created waiting for the confirmation of Stop
let lastBar = '';

const keyOf = x => `${x.pid}:${x.created}`;
const DAY = 86_400_000;
const ageMs = x => (x.created ? Date.now() - new Date(x.created).getTime() : 0);
const old = x => ageMs(x) > DAY;

/** Roots listed, and whether an orphan has been running for more than a day (orange count on the tab). */
export function processCount() {
  const items = processes()?.items || [];
  return { n: items.length, warn: items.some(x => (x.kind === 'project' || x.kind === 'unknown' || x.deadParent) && old(x)) };
}

let reading = null;
/** Reads again (one call at a time); the tab repaints if it is displayed. */
export function refreshProcesses() {
  if (!onPc() || reading) return reading;
  reading = readProcesses()
    .then(r => processes.set(r), e => processes.set({ error: e.message, items: processes()?.items || [] }))
    .finally(() => { reading = null; });
  return reading;
}
// The count of the tab stays roughly up to date while another tab is displayed (one reading a minute)
setInterval(() => { if (onPc() && !document.hidden && sideTab() !== 'processes') refreshProcesses(); }, 60_000);

const mb = n => (n >= 1024 ** 3 ? t('side.processes.gb', { n: (n / 1024 ** 3).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('side.processes.mb', { n: Math.round(n / 1024 ** 2) }));
function age(x) {
  const ms = ageMs(x);
  if (ms < 3_600_000) return t('side.processes.minutes', { n: Math.max(1, Math.round(ms / 60_000)) });
  if (ms < DAY) return t('side.processes.hours', { n: Math.round(ms / 3_600_000) });
  return t('side.processes.days', { n: Math.round(ms / DAY) });
}
const sessionTitle = slug => sessions().find(s => s.slug === slug)?.title || slug;

function row(x) {
  const k = keyOf(x), open = expanded.has(k);
  const detached = x.kind === 'session' && x.deadParent;
  const chain = [
    x.deadParent ? `<span class="pr-dead">${t('side.processes.gone', { pid: x.deadParent })}</span>` : '',
    ...x.chain.map(c => (c === 'claude' && x.agent ? `claude › <span class="pr-tag">${t('side.processes.agent', { name: esc(x.agent) })}</span>` : esc(c))),
    esc(x.exe.replace(/\.exe$/i, '')),
  ].filter(Boolean).join(' › ');
  return `<div class="pr-proc" data-pr="${esc(k)}">
    <div class="pr-row"><span class="pr-chev">${open ? '▾' : '▸'}</span><span class="pr-name" title="${esc(x.cmd)}">${esc(x.name)}</span>
      ${x.ports.map(p => `<span class="pr-port">:${p}</span>`).join('')}
      ${detached ? `<span class="pr-tag det" title="${t('side.processes.detachedTitle')}">${t('side.processes.detached')}</span>` : ''}
      <span class="pr-ram ${x.ram > 1024 ** 3 ? 'big' : ''}">${mb(x.ram)}</span><span class="pr-age ${old(x) ? 'old' : ''}" title="${esc(new Date(x.created).toLocaleString(locale()))}">${age(x)}</span>
      <button class="pr-kill" data-pr-kill="${esc(k)}">${t('side.processes.stop')}</button></div>
    <div class="pr-chain">${chain}</div>
    ${open ? `<div class="pr-detail">
      <div class="m">${t('side.processes.started', { pid: x.pid, when: esc(new Date(x.created).toLocaleString(locale())) })}</div>
      ${x.command ? `<div class="m">${t('side.processes.launchedBy')}</div><code>${esc(x.command)}</code>` : ''}
      <div class="m">${t('side.processes.commandLine')}</div><code>${esc(x.cmd)}</code>
      ${x.children.length ? `<div class="m">${t('side.processes.children', { n: x.children.length })}</div>${x.children.map(c => `<div class="pr-child"><span>${esc(c.name)}</span><span class="m">PID ${c.pid}</span><span class="pr-ram">${mb(c.ram)}</span></div>`).join('')}` : ''}
    </div>` : ''}
    ${confirming === k ? `<div class="pr-confirm"><span>${t('side.processes.confirm', { name: esc(x.name), n: 1 + x.children.length, ram: mb(x.ram) })}</span><span class="sp"></span>
      <button data-pr-cancel>${t('side.processes.cancel')}</button><button class="go" data-pr-go="${esc(k)}">${t('side.processes.stop')}</button></div>` : ''}
  </div>`;
}

/** Groups of a section: [{ label, current?, items }] in display order. */
const groupBy = (items, keyFn, labelFn, first) => {
  const m = new Map();
  for (const x of items) { const k = keyFn(x); (m.get(k) || m.set(k, []).get(k)).push(x); }
  return [...m].sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : 0)).map(([k, list]) => ({ key: k, label: labelFn(k, list), current: k === first, items: list }));
};

function sections(d, r) {
  const here = r.projects?.[d.slug] || null;
  const items = r.items.slice().sort((a, b) => b.ram - a.ram);
  const sess = items.filter(x => x.kind === 'session');
  const mine = sess.filter(x => x.project === here || (!here && x.slug === d.slug));
  const others = sess.filter(x => !mine.includes(x));
  return [
    { id: 'here', title: t('side.processes.sectionHere', { project: esc(here || t('side.processes.thisSession')) }), groups: groupBy(mine, x => x.slug, k => esc(sessionTitle(k)) + (k === d.slug ? ` <span class="m">${t('side.processes.thisSessionNote')}</span>` : ''), d.slug) },
    { id: 'others', title: t('side.processes.sectionOthers'), groups: groupBy(others, x => `${x.project || '?'}\u0000${x.slug}`, k => { const [p, s] = k.split('\u0000'); return `${esc(p)} <span class="m">› ${esc(sessionTitle(s))}</span>`; }) },
    { id: 'tools', title: t('side.processes.sectionTools'), groups: groupBy(items.filter(x => x.kind === 'tool'), x => x.tool.pid, (k, list) => {
      const projects = [...new Set(list.map(x => x.project).filter(Boolean))];
      return `${esc(list[0].tool.label)}${projects.length ? ` <span class="m">· ${esc(projects.join(', '))}</span>` : ''}`;
    }) },
    { id: 'orphans', title: t('side.processes.sectionOrphans'), groups: groupBy(items.filter(x => x.kind === 'project'), x => x.project, k => esc(k), here) },
    { id: 'unknown', title: t('side.processes.sectionUnknown'), hint: t('side.processes.unknownHint'), groups: [{ key: '', label: '', items: items.filter(x => x.kind === 'unknown') }] },
  ].filter(s => s.groups.some(g => g.items.length));
}

function paint(d) {
  const r = processes();
  const right = $('#right');
  const scroll = right.scrollTop;
  if (!r) { right.innerHTML = lastBar + skeleton('lines', 6); return; }
  const list = sections(d, r);
  const total = r.items.reduce((s, x) => s + x.ram, 0);
  right.innerHTML = lastBar + `<div id="processes">
    <div class="pr-summary"><span>${t('side.processes.summary', { n: r.items.length, ram: mb(total) })}</span><span class="sp"></span>
      <button data-pr-refresh title="${t('side.processes.refresh')}">↻</button></div>
    ${r.error ? `<div class="m pr-error">${esc(r.error)}</div>` : ''}
    ${list.length ? list.map(s => {
      const shut = collapsed.has(s.id);
      const n = s.groups.reduce((a, g) => a + g.items.length, 0);
      const ram = s.groups.reduce((a, g) => a + g.items.reduce((b, x) => b + x.ram, 0), 0);
      return `<h3 class="pr-section" data-pr-section="${s.id}">${shut ? '▸' : '▾'} ${s.title} <span class="m">· ${n} · ${mb(ram)}${s.hint ? ` · ${s.hint}` : ''}</span></h3>
        ${shut ? '' : s.groups.map(g => `${g.label ? `<div class="pr-group ${g.current ? 'current' : ''}">${g.label}</div>` : ''}${g.items.map(row).join('')}`).join('')}`;
    }).join('') : `<div class="m">${t('side.processes.none')}</div>`}
  </div>`;
  right.scrollTop = scroll;
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  $('#right').addEventListener('click', async e => {
    if (!$('#processes')) return;
    const d = detail();
    const sec = e.target.closest('[data-pr-section]');
    if (sec) {
      const id = sec.dataset.prSection;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      write('dash-processes-collapsed', [...collapsed]);
      return paint(d);
    }
    if (e.target.closest('[data-pr-refresh]')) { await refreshProcesses(); return; }
    const kill = e.target.closest('[data-pr-kill]');
    if (kill) { confirming = kill.dataset.prKill; return paint(d); }
    if (e.target.closest('[data-pr-cancel]')) { confirming = null; return paint(d); }
    const go = e.target.closest('[data-pr-go]');
    if (go) {
      const x = processes()?.items.find(i => keyOf(i) === go.dataset.prGo);
      confirming = null;
      if (!x) return paint(d);
      go.disabled = true;
      try { await killProcess(x.pid, x.created); } catch (err) { alert(t('side.processes.stopFailed', { message: err.message })); }
      await refreshProcesses();
      return;
    }
    if (e.target.closest('.pr-detail')) return; // selecting a command line does not fold it
    const line = e.target.closest('[data-pr]');
    if (line) {
      const k = line.dataset.pr;
      expanded.has(k) ? expanded.delete(k) : expanded.add(k);
      paint(d);
    }
  });
}

/** Paints the tab for session `d`, tab bar `bar` on top; the first time, reads the processes. */
export function renderProcesses(d, bar) {
  listen();
  lastBar = bar;
  $('#right').classList.remove('mode-git');
  paint(d);
  if (!processes() || processes().error) refreshProcesses();
}
/** Repaint after a reading (called by the effect of tabs.js), without reading again. */
export const repaintProcesses = d => { if ($('#processes') || !processes()) paint(d); };
