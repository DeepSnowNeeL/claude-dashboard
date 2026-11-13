// Subagents: tabs to switch from the main conversation to an agent's, and tabs of the background shells.
// An effect rerenders them when the view, the agents or the shells change.
import { effect } from '../../core/signals.js';
import { $, esc, chrono, tickChronos } from '../../core/dom.js';
import { current, view, agents, shells } from '../../core/state.js';
import { stopAgent } from '../../services/sessions.js';
import { AGENT_ICON, agentStateLabel, requestView } from '../cards/agent.js';
import { openShell } from './shell.js';
import { t } from '../../i18n/index.js';

function renderTabs() {
  const z = $('#tabs');
  if (!z) return;
  // As in Claude Code: only running agents have a tab (plus the one being viewed, even if done); a finished agent
  // stays reachable through its card in the feed. Running background shells follow (click: their output).
  const agentTabs = [...agents().values()].filter(a => a.state === 'working' || view() === a.key);
  const shellTabs = [...shells().values()].filter(x => x.state === 'working');
  $('#center').classList.toggle('agent-view', !!(view() && agents().get(view()))); // before returning: a session without agents must not keep the agent view
  if (!agentTabs.length && !shellTabs.length) { z.innerHTML = ''; return; }
  const running = agentTabs.filter(a => a.state === 'working').length;
  const count = [running && t('conversation.tabs.subagents', { n: running }), shellTabs.length && t('conversation.tabs.shells', { n: shellTabs.length })].filter(Boolean).join(' · ');
  z.innerHTML = `${agentTabs.length ? `<button class="tab ${!view() ? 'on' : ''}" data-view="">${t('conversation.tabs.main')}</button>` : ''}
    ${agentTabs.map(a => `<button class="tab ${view() === a.key ? 'on' : ''} e-${esc(a.state)}" data-view="${esc(a.key)}" title="${esc(a.description)}">
      ${AGENT_ICON[a.state] || '⏳'} 🤖 ${esc(a.description || a.type)} <span class="m">${chrono(a.start, a.state === 'working' ? null : a.end || Date.now(), a.state === 'working' ? null : a.durationMs)}</span></button>`).join('')}
    ${shellTabs.map(x => `<button class="tab shell" data-shell="${esc(x.key)}" title="${esc(x.command || x.description)}">⏳ 🐚 ${esc(x.description || x.command || t('conversation.tabs.command'))} <span class="m">${chrono(x.start)}</span></button>`).join('')}
    <span class="m">${count ? t('conversation.tabs.running', { count }) : ''}</span>`;
  z.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => requestView(b, b.dataset.view || null)));
  z.querySelectorAll('[data-shell]').forEach(b => b.addEventListener('click', () => openShell(b.dataset.shell)));
  const a = view() && agents().get(view());
  $('#center').classList.toggle('agent-view', !!a);
  const banner = $('#agent-banner');
  if (banner) banner.innerHTML = a ? `<span>🤖 <b>${esc(a.type)}</b> · ${esc(a.description)} · ${AGENT_ICON[a.state] || ''} ${agentStateLabel(a)}</span>
    ${a.state === 'working' ? `<button class="btn stop" id="stop-agent">${t('conversation.tabs.stopAgent')}</button>` : ''}
    <button class="btn" data-back>${t('conversation.tabs.back')}</button>` : '';
  $('#stop-agent')?.addEventListener('click', () => stopAgent(current(), view()).catch(err => alert(err.message)));
  banner?.querySelector('[data-back]')?.addEventListener('click', e => requestView(e.currentTarget, null));
}

/** Tabs of agents and shells (#tabs, #agent-banner, recreated with the center): rerendered by an effect. */
export function mountTabs() {
  effect(() => { view(); agents(); shells(); renderTabs(); });
  tickChronos(); // durations of running agents and shells (tabs, cards, banner), without rerendering // read first: #tabs may be missing at this point
}
