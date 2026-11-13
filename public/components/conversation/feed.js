// The conversation feed: its event array, targeted rendering (an SSE event adds or replaces a single element,
// never a full render), subagent conversations, automatic scrolling.
import { signal } from '../../core/signals.js';
import { $, esc } from '../../core/dom.js';
import { current, view, agents, shells } from '../../core/state.js';
import { readAgentFeed } from '../../services/sessions.js';
import { loadUsage } from '../usage.js';
import { eventHtml, fillTool } from './event.js';
import { t } from '../../i18n/index.js';

let feed = [];
const agentFeeds = new Map(); // key → events of its conversation (loaded when opened, then live)
// Changes when a message or a command of the feed changes: the send buttons (input.js) depend on the queue
const queueVersion = signal(0);

export const hasQueued = () => (queueVersion(), feed.some(ev => ev.t === 'user' && ev.queued));
export const commandRunning = () => (queueVersion(), feed.some(ev => ev.t === 'command' && ev.running));

/** The active decisions are those of the last "decisions" event that has not been answered yet. */
function activeDecisionsId() {
  for (let i = feed.length - 1; i >= 0; i--) {
    if (feed[i].t === 'user') return null;
    if (feed[i].t === 'decisions') return feed[i].id;
  }
  return null;
}

// Queued messages (sent during a turn, or received from another session): at the end of the feed, in a zone that
// scrolls with the conversation (not a fixed zone above the input); the turn's events are inserted before it.
function queueZone(container) {
  if (container.id !== 'feed' || view()) return null;
  let z = container.querySelector(':scope > .queue');
  if (!z) { z = document.createElement('div'); z.className = 'queue'; z.dataset.label = t('conversation.feed.queueLabel'); container.append(z); }
  return z;
}
const add = (container, el) => { const z = container.querySelector(':scope > .queue'); if (z) container.insertBefore(el, z); else container.append(el); };
const last = container => { const d = container.lastElementChild; return d?.classList.contains('queue') ? d.previousElementSibling : d; };

/** Adds or replaces an event; consecutive tools are grouped in one collapsed line. */
function placeEvent(ev, container = $('#feed')) {
  if (!container) return;
  const old = container.querySelector(`[data-id="${CSS.escape(ev.id)}"]`);
  if (ev.t === 'tool') {
    // The result comes after the call: the line is updated in place (expanded or not)
    if (old) { fillTool(old, ev); return; }
    let group = last(container);
    if (!group?.classList.contains('tools')) {
      group = document.createElement('details');
      group.className = 'tools';
      group.innerHTML = '<summary></summary><div class="lines"></div>';
      add(container, group);
    }
    const l = document.createElement('details');
    l.dataset.id = ev.id;
    l.className = 'tool';
    l.addEventListener('toggle', () => { if (l.open) fillTool(l, l._ev, true); });
    fillTool(l, ev);
    group.querySelector('.lines').append(l);
    const n = group.querySelectorAll('.lines > .tool').length;
    group.querySelector('summary').innerHTML = `⚙ ${t('conversation.feed.tools', { n })} · <span>${esc(ev.name)} ${esc(ev.summary)}</span>`;
    return;
  }
  // Queued message: at the bottom of the feed (queue zone) until it leaves; once sent, it takes its place in the
  // conversation, at the moment it was sent
  const isQueued = ev.t === 'user' && ev.queued;
  const queue = container.id === 'feed' && (isQueued ? queueZone(container) : container.querySelector(':scope > .queue'));
  const inQueue = queue && queue.querySelector(`[data-id="${CSS.escape(ev.id)}"]`);
  const el = eventHtml(ev, activeDecisionsId());
  if (!el) { inQueue?.remove(); return; }
  if (queue && isQueued) { if (inQueue) inQueue.replaceWith(el); else queue.append(el); return; }
  if (inQueue) { inQueue.remove(); add(container, el); return; }
  if (old) old.replaceWith(el); else add(container, el);
}

function renderFeed() {
  const c = $('#feed');
  c.innerHTML = '';
  for (const ev of view() ? agentFeeds.get(view()) || [] : feed) placeEvent(ev, c);
  followFeed(c);
  feedBottom(true);
  // The agent tabs rerender through their effect (tabs.js): view, agents and shells are signals
}

function noteAgents(evs) {
  for (const ev of evs) {
    if (ev.t === 'agent') agents().set(ev.key, ev);
    else if (ev.t === 'shell') shells().set(ev.key, ev);
  }
  agents.notify(); shells.notify();
}

/** The displayed session changes: no more agent view, nor known agents or shells. */
export function forgetAgents() {
  view.set(null); agentFeeds.clear(); agents().clear(); agents.notify(); shells().clear(); shells.notify();
}

/** Full feed of the displayed session (loaded when opened): rendered once, entirely. */
export function replaceFeed(evs) {
  feed = evs;
  noteAgents(feed);
  renderFeed();
}

async function openView(key) {
  view.set(key);
  if (key && !agentFeeds.has(key)) {
    try { agentFeeds.set(key, await readAgentFeed(current(), key)); } catch (e) { alert(e.message); view.set(null); }
  }
  renderFeed();
}

/** Event received live for the displayed session: stored (main conversation or an agent's), then placed. */
export function addEvent(ev) {
  if (ev.t === 'cleared' && !ev.agent) { feed = [ev]; forgetAgents(); renderFeed(); return; } // /clear: the feed starts over
  if (ev.t === 'agent') { agents().set(ev.key, ev); agents.notify(); }
  if (ev.t === 'shell' && !ev.agent) { shells().set(ev.key, ev); shells.notify(); }
  // Event of a subagent: stored in its conversation, shown only if that is the one being viewed.
  const target = ev.agent ? agentFeeds.get(ev.agent) : feed;
  if (!target) return; // agent conversation not opened yet: it will be loaded entirely when opened
  const i = target.findIndex(x => x.id === ev.id);
  if (i >= 0 && target[i].queued && !ev.queued) { target.splice(i, 1); target.push(ev); } // left the queue: at its send position
  else if (i >= 0) target[i] = ev; else target.push(ev);
  if ((ev.agent || null) !== view()) return;
  // A sent answer turns off the previous decision cards.
  if (ev.t === 'user') document.querySelectorAll('#feed .card.dec.active').forEach(c => { c.classList.replace('active', 'past'); c.querySelectorAll('.choices, .clarification').forEach(x => x.remove()); });
  $('#feed .empty-home')?.remove(); // first event of a new session
  placeEvent(ev);
  if (ev.t === 'command' || ev.t === 'user') queueVersion.update(n => n + 1); // buttons depend on the queue
  if (ev.t === 'end') loadUsage();
  feedBottom(ev.t === 'user');
}

/**
 * Separator "n new items since your last visit" before the first rendered element after the event `id`
 * (the last of the feed when the developer looked at the session). The feed scrolls to it if it is above the screen.
 */
export function placeSeparator(id, n) {
  const c = $('#feed');
  c?.querySelector(':scope > .sep-new')?.remove();
  const i = feed.findIndex(ev => ev.id === id);
  if (!c || view() || i < 0) return;
  for (const ev of feed.slice(i + 1)) {
    const el = c.querySelector(`[data-id="${CSS.escape(ev.id)}"]`);
    const top = el?.closest('#feed > *'); // a tool is inside its collapsed line
    if (!top || top.classList.contains('queue')) continue;
    const sep = document.createElement('div');
    sep.className = 'sep-new';
    sep.textContent = t('conversation.feed.news', { n });
    c.insertBefore(sep, top);
    const gap = sep.getBoundingClientRect().top - c.getBoundingClientRect().top;
    if (gap < 0) { follow = false; c.scrollTop += gap - 12; $('#new-items')?.classList.add('on'); }
    return;
  }
}

// Automatic scrolling: the feed stays stuck to the bottom until the user scrolls up to reread it.
let follow = true;
function followFeed(c) {
  follow = true;
  if (c.dataset.following) return; // already wired (the feed is rerendered when switching conversations)
  c.dataset.following = '1';
  // Only a gesture of the developer (wheel, scrollbar, touch, keys) can suspend following: scrolls done by the page
  // itself do not count. Going back to the bottom, by any means, resumes it.
  let gesture = 0;
  const mark = () => { gesture = Date.now(); };
  c.addEventListener('wheel', mark, { passive: true });
  c.addEventListener('pointerdown', mark);
  c.addEventListener('touchmove', mark, { passive: true });
  c.addEventListener('keydown', e => { if (/^(PageUp|PageDown|ArrowUp|ArrowDown|Home|End| )$/.test(e.key)) mark(); });
  c.addEventListener('scroll', () => {
    // overflow-x: hidden does not stop the browser from shifting the feed (selection, focus, temporarily too wide
    // content): on mobile, it stayed cut on the left until reload.
    if (c.scrollLeft) c.scrollLeft = 0;
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
    if (atBottom) follow = true;
    else if (Date.now() - gesture < 600) follow = false;
    $('#new-items')?.classList.toggle('on', !follow);
  });
  // Any change of the feed (live text, card, image loading, expanded block) sticks back to the bottom if following.
  new MutationObserver(() => feedBottom(false)).observe(c, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(() => feedBottom(false)).observe(c);
  c.addEventListener('load', () => feedBottom(false), true); // attachment images
  if (!$('#new-items')) {
    const b = document.createElement('button');
    b.id = 'new-items';
    b.className = 'btn new-items';
    b.textContent = t('conversation.feed.backToBottom');
    b.onclick = () => feedBottom(true);
    ($('.input') || c.parentElement).prepend(b); // just above the input, whatever the height of the bottom
  }
}

export function feedBottom(force) {
  const c = $('#feed');
  if (!c) return;
  if (force) follow = true;
  if (!follow) return;
  c.scrollTop = c.scrollHeight - c.clientHeight;
  $('#new-items')?.classList.remove('on');
}

/**
 * Mounts the feed on `el` (#center, which stays in place from one session to another): agent cards and tabs ask
 * for a conversation there ("open-view" event, key of the agent or null for the main one).
 */
export function mountFeed(el) {
  el.addEventListener('open-view', e => openView(e.detail || null));
}
