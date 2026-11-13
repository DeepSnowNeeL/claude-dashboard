// Card of a subagent in the feed: type, description, state; "See its conversation" opens its tab, an
// interrupted agent can be resumed.
import { esc, chrono } from '../../core/dom.js';
import { agents, current, detail } from '../../core/state.js';
import { send } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

export const AGENT_ICON = { working: '⏳', completed: '✓', failed: '✗', stopped: '■' };

/** State of an agent in HTML: state, tools, duration (ticking while it runs), last tool. */
export function agentStateLabel(a) {
  const state = ['working', 'completed', 'failed', 'stopped'].includes(a.state) ? t(`cards.agent.states.${a.state}`) : a.state;
  const end = a.state === 'working' ? null : (a.end || Date.now());
  return `${esc(state)} · ${t('cards.agent.tools', { n: a.tools || 0 })} · ⏱ ${chrono(a.start, end, a.state === 'working' ? null : a.durationMs)}${a.lastTool && a.state === 'working' ? ` · ${esc(a.lastTool)}` : ''}`;
}

/** Asks to display an agent's conversation (`null`: the main one); the feed listens (components/conversation/feed.js). */
export function requestView(from, key) {
  from.dispatchEvent(new CustomEvent('open-view', { bubbles: true, detail: key }));
}

export function agentCard(ev) {
  return `<div class="card agent e-${esc(ev.state)}">
    <div><b>🤖 ${esc(ev.type)}</b> · ${esc(ev.description)}${ev.background ? ` <span class="m">${t('cards.agent.background')}</span>` : ''}</div>
    <div class="m">${AGENT_ICON[ev.state] || ''} ${agentStateLabel(ev)}</div>
    ${ev.summary ? `<div class="m">${esc(ev.summary.length > 220 ? `${ev.summary.slice(0, 220).replace(/\s+\S*$/, '')}…` : ev.summary).replace(/\n+/g, ' ')}</div>` : ''}
    <button class="btn" data-open-agent="${esc(ev.key)}">${t('cards.agent.seeConversation')}</button>
    ${['stopped', 'failed'].includes(ev.state) && ev.agentId && !replaced(ev) ? `<button class="btn" data-resume-agent="${esc(ev.key)}" title="${t('cards.agent.resumeTitle')}">${t('cards.agent.resume')}</button>` : ''}
    ${replaced(ev) ? `<span class="m">${t('cards.agent.relaunched')}</span>` : ''}
  </div>`;
}
export function attachAgent(el, ev) {
  el.querySelector('[data-open-agent]').addEventListener('click', e => requestView(e.currentTarget, ev.key));
  el.querySelector('[data-resume-agent]')?.addEventListener('click', e => { e.target.disabled = true; resumeAgent(ev); });
}
/** An agent is "replaced" when another one, launched later, has the same description (a relaunch). */
const replaced = ev => [...agents().values()].some(a => a.key !== ev.key && a.description === ev.description && (a.start || 0) > (ev.start || 0));

/** Resuming an interrupted agent: the main session relaunches it with SendMessage on its id. */
async function resumeAgent(ev) {
  const text = t('cards.agent.resumePrompt', { description: ev.description, agentId: ev.agentId });
  await send(current(), { text, when: detail()?.busy ? 'end' : 'now' }).catch(err => alert(err.message));
}
