// Conversation header: title (renamable), counters, ticket, steps, permission mode, End, ⋯ menu (Reload, Archive).
// An effect rerenders it when the session detail changes.
import { effect } from '../../core/signals.js';
import { $, esc, rich, toast, ticketLink, displayName, kTokens, modelLabel } from '../../core/dom.js';
import { current, detail, projects, sessions } from '../../core/state.js';
import { setMode, setModel, readModels, end, reload, archive, rename, sendActive as postActive, sendActiveFinal } from '../../services/sessions.js';
import { loadList, pathKey } from '../../services/projects.js';
import { trackerProfile } from '../tracker/renderers.js';
import { modeOptions } from '../../core/modes.js';
import { openMenu } from '../tree/menu.js';
import { t } from '../../i18n/index.js';

const STEPS = ['framing', 'mockup', 'design', 'execution', 'push'];
let refresh = () => Promise.resolve(); // rereads the displayed session (given by app.js when mounting)

// Working folder of the session (click: path menu, explorer, copy) and its branch if it is a worktree
function folder(d) {
  if (!d.cwd) return esc(d.project || '');
  const c = pathKey(d.cwd);
  const w = projects().flatMap(p => p.worktrees).filter(x => c === x.id || c.startsWith(x.id + '/')).sort((a, b) => b.id.length - a.id.length)[0];
  return `<a class="path cwd" data-path="${esc(d.cwd)}" title="${esc(t('conversation.header.folderTitle', { path: d.cwd }))}">📁 ${esc(d.cwd)}</a>${w?.branch ? ` <span title="${t('conversation.header.branchTitle')}">⎇ ${esc(w.branch)}</span>` : ''}`;
}

/** Session launched by another one: link to it, next to the title. */
function parentLink(d) {
  const parent = d.parent && sessions().find(s => s.slug === d.parent);
  return parent ? `<a class="parent" href="#${esc(parent.slug)}" title="${t('tree.parentTitle')}">↖ ${t('tree.launchedBy', { name: displayName(parent) })}</a>` : '';
}

export function renderHeader(d) {
  if (!$('#head')) return; // no conversation shown (new session, session not found)
  if (document.activeElement?.classList.contains('title-field')) return; // renaming in progress: do not wipe it
  const steps = trackerProfile(d).steps?.length ? trackerProfile(d).steps.map(e => [e.key, e.label]) : STEPS.map(k => [k, t(`conversation.header.steps.${k}`)]); // those of the tracker profile
  const iStep = steps.findIndex(([k]) => k === d.step);
  $('#head').innerHTML = `
    <div class="header">
      <div class="title" id="session-title" title="${t('conversation.header.renameTitle')}${d.titlePinned ? t('conversation.header.renameTitlePinned') : ''}">${displayName(d)}<span class="pencil">✎</span>${d.titlePinned ? `<span class="m pinned" title="${t('conversation.header.pinnedTitle')}">📌</span>` : ''}${parentLink(d)}</div>
      <span class="m stats" id="stats"></span>
      <span class="m">${ticketLink(d) ? `<a href="${esc(ticketLink(d))}" target="_blank">${t('conversation.header.ticket', { ticket: esc(d.ticket || '') })}</a> · ` : d.ticket ? `🎫 ${esc(d.ticket)} · ` : ''}${folder(d)}</span>
    </div>
    ${d.description ? `<div class="desc">${rich(d.description)}</div>` : ''}
    <div class="head-row">
      <div class="steps">${steps.map(([k, lbl], i) => `<span class="${i < iStep ? 'done' : i === iStep ? 'current' : ''}">${i < iStep ? '✓ ' : ''}${esc(lbl)}</span>`).join('')}</div>
      ${d.driven ? `<div class="commands">
        ${modelButton(d)}
        <select id="mode" title="${t('conversation.header.modeTitle')}">${modeOptions(d.mode, d.autoMode)}</select>
        ${d.status === 'done' ? `<span class="m" title="${t('conversation.header.doneTitle')}">${t('conversation.header.done')}</span>`
          : d.paused ? `<span class="m" title="${t('conversation.header.pausedTitle')}">${t('conversation.header.paused')}</span>` : ''}
        ${d.busy ? `<span class="m">${t('conversation.header.busy')}</span>` : ''}
        ${d.status !== 'done' ? `<button class="btn" id="end" title="${t('conversation.header.endTitle')}">${t('conversation.header.end')}</button>` : ''}
        <button class="btn more" id="more" title="${t('conversation.header.moreTitle')}">⋯</button>
      </div>` : ''}
    </div>`;
  $('#model')?.addEventListener('click', e => modelMenu(d, e.currentTarget));
  $('#mode')?.addEventListener('change', e => setMode(d.slug, e.target.value).catch(err => alert(err.message)));
  // Rename: the title becomes a field; Enter pins the name (Claude no longer changes it), empty = automatic name
  $('#session-title')?.addEventListener('click', e => {
    const el = $('#session-title');
    if (el.querySelector('input') || e.target.closest('.parent')) return; // "↖ launched by" opens the parent
    el.innerHTML = `<input class="title-field" value="${esc(d.title || '')}" placeholder="${t('conversation.header.autoName')}">`;
    const field = el.querySelector('input');
    field.focus(); field.select();
    let finished = false;
    const finish = async keep => {
      if (finished) return;
      finished = true;
      field.blur(); // otherwise renderHeader thinks the renaming is still in progress and keeps the field
      const title = field.value.trim();
      if (keep && title !== (d.title || '')) {
        // The field disappears right away; the engine update (automatic name if empty) follows
        const r = await rename(d.slug, title).catch(err => { alert(err.message); return null; });
        if (r && title) Object.assign(d, { title, titlePinned: true });
        if (r && !title) delete d.titlePinned;
      }
      renderHeader(d);
      if (keep) loadList().then(refresh).catch(() => {});
    };
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
  });
  $('#end')?.addEventListener('click', async () => {
    if (d.busy && !confirm(t('conversation.header.confirmEnd'))) return;
    try { await end(d.slug); } catch (err) { return alert(err.message); }
    location.hash = ''; // the session leaves the screen; it stays in "ended" and a message resumes it
    toast(t('conversation.header.ended', { title: d.title || d.slug }));
  });
  $('#more')?.addEventListener('click', e => moreMenu(d, e.currentTarget));
  renderStats();
}

// ⋯ menu: the less frequent actions. Reload restarts Claude Code on the same conversation (MCP servers, settings,
// skills, CLAUDE.md read again), as quitting the terminal and `claude -r`.
function moreMenu(d, el) {
  const r = el.getBoundingClientRect();
  openMenu(t('conversation.header.moreMenu'), [
    { ic: '🔄', label: t('conversation.header.reload'), run: async () => {
      const sum = sessions().find(x => x.slug === d.slug); // running subagents and shells are counted in the list
      if ((d.busy || sum?.runningAgents || sum?.runningShells) && !confirm(t('conversation.header.confirmReload'))) return;
      await reload(d.slug);
      toast(t('conversation.header.reloaded'));
    } },
    { ic: '🗄', label: t('conversation.header.archive'), run: async () => {
      if (d.busy && !confirm(t('conversation.header.confirmArchive'))) return;
      await archive(d.slug);
      location.hash = '';
      toast(t('conversation.header.archived', { title: d.title || d.slug }));
    } },
  ], r.right - 220, r.bottom + 4);
}

// Model pill: the model of the last call, or before the first message the one chosen (otherwise "Default"),
// so that it can be changed before writing anything
function modelButton(d) {
  const id = d.model || (d.modelChoice && d.modelChoice !== 'default' ? d.modelChoice : '');
  const name = id ? modelLabel(id).name : t('conversation.header.modelDefault');
  return `<button class="model-pill f-${modelLabel(id).family || 'other'}" id="model" title="${esc(t('conversation.header.modelTitle', { model: id || name }))}">${esc(name)} ▾</button>`;
}
// Model menu: list of the models of the SDK, a choice applies from the next call (setModel)
async function modelMenu(d, el) {
  const r = el.getBoundingClientRect();
  let list;
  try { list = await readModels(d.slug); } catch (err) { return alert(err.message); }
  const chosen = d.modelChoice ? list.models.findIndex(m => m.value === d.modelChoice)
    : d.model ? list.models.findIndex(m => sameModel(m.resolvedModel || m.value, d.model)) : list.models.findIndex(m => m.value === 'default');
  openMenu(t('conversation.header.modelMenu'), list.models.map((m, i) => ({
    ic: i === chosen ? '✓' : '',
    label: m.value === 'default' && m.resolvedModel ? t('newSession.modelDefaultIs', { model: modelLabel(m.resolvedModel).name }) : m.displayName || m.value,
    run: async () => { await setModel(d.slug, m.value); toast(t('conversation.header.modelChanged', { model: m.displayName || m.value })); },
  })), r.left, r.bottom + 4);
}
const baseModel = id => String(id || '').replace(/\[\w+\]$/, '');
const sameModel = (a, b) => { const x = baseModel(a).replace(/-\d{8}$/, ''); return !!x && x === baseModel(b).replace(/-\d{8}$/, ''); };

// --- Session counters: Claude's time, exchanges, your active time ----------------------
// Active = tab in the foreground with activity (mouse, keyboard, wheel) in the last minute.

const duration = ms => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};
// Context: orange from 50 % of the window, red from 75 %
const tier = st => { const p = st.window ? st.context / st.window : 0; return p >= .75 ? 'ctx-red' : p >= .5 ? 'ctx-orange' : ''; };
let pendingActive = 0, activeSlug = null, lastActivity = 0;

function renderStats() {
  const z = $('#stats');
  if (!z || !detail()) return;
  const st = { claudeMs: 0, exchanges: 0, activeMs: 0, ...detail().stats };
  const active = st.activeMs + (activeSlug === detail().slug ? pendingActive : 0);
  const key = `${st.claudeMs}|${st.exchanges}|${duration(active)}|${st.context}|${st.window}`;
  if (z.dataset.v === key) return; // no rewrite every second (keeps the tooltip open)
  z.dataset.v = key;
  z.innerHTML = `<span title="${t('conversation.header.stats.claudeTitle')}">${t('conversation.header.stats.claude', { duration: duration(st.claudeMs) })}</span>
    <span title="${t('conversation.header.stats.exchangesTitle')}">${t('conversation.header.stats.exchanges', { n: st.exchanges })}</span>
    <span title="${t('conversation.header.stats.youTitle')}">${t('conversation.header.stats.you', { duration: duration(active) })}</span>${st.context ? `
    <span class="${tier(st)}" title="${t('conversation.header.stats.contextTitle', { window: st.window ? t('conversation.header.stats.contextWindow', { size: kTokens(st.window) }) : '' })}">🧠 ${kTokens(st.context)}${st.window ? ` / ${kTokens(st.window)} · ${Math.round(st.context / st.window * 100)} %` : ''}</span>` : ''}`;
}

async function sendActive() {
  if (!activeSlug || !pendingActive) return;
  const slug = activeSlug, ms = pendingActive;
  pendingActive = 0;
  try {
    await postActive(slug, ms);
    if (detail()?.slug === slug) detail().stats = { claudeMs: 0, exchanges: 0, activeMs: 0, ...detail().stats, activeMs: (detail().stats?.activeMs || 0) + ms };
  } catch { if (activeSlug === slug) pendingActive += ms; }
}

/**
 * Mounts the header: an effect rerenders it when the detail changes; the active time counters tick.
 * `reread()` rereads the displayed session after a rename.
 */
export function mountHeader(reread) {
  refresh = reread;
  effect(() => { const d = detail(); if (d) renderHeader(d); });
  ['mousemove', 'keydown', 'wheel', 'pointerdown', 'touchstart'].forEach(type => addEventListener(type, () => (lastActivity = Date.now()), { passive: true, capture: true }));
  setInterval(() => {
    if (!current() || !detail()) return;
    if (activeSlug !== current()) { sendActive(); activeSlug = current(); }
    if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastActivity < 60_000) {
      pendingActive += 1000;
      renderStats();
    }
  }, 1000);
  setInterval(sendActive, 15_000);
  addEventListener('pagehide', () => {
    if (activeSlug && pendingActive) sendActiveFinal(activeSlug, pendingActive);
  });
}
