// Center of the page: open a session (header, feed, input), reread it on an "update", switch from one open session
// to another (Ctrl+Tab).
import { $, esc, skeleton, sessionSkeleton } from '../../core/dom.js';
import { sessions, current, detail, activity, relativeDir } from '../../core/state.js';
import { readSession, readFeed, markSeen } from '../../services/sessions.js';
import { loadList } from '../../services/projects.js';
import { syncDraft, readDraft } from '../../services/draft.js';
import { revealInTree } from '../tree/tree.js';
import { decisionCards, attachDecisions, highlight } from '../cards/decisions.js';
import { renderNewSession } from '../new-session.js';
import { mobileView } from '../mobile.js';
import { renderHeader } from './header.js';
import { replaceFeed, forgetAgents, placeSeparator } from './feed.js';
import { attachInput } from './input.js';
import { renderActivity } from './activity.js';
import { t } from '../../i18n/index.js';

let lastRevealed = null; // last session expanded in the tree (once per opening, not on every refresh)

// --- Navigation between open sessions (Ctrl+Tab) ------------------------------------------------------------

/** Open sessions (not ended) in tree order; those of collapsed projects follow, in list order. */
function neighbourSession(step) {
  const shown = [...document.querySelectorAll('#list a.sess')].map(a => a.getAttribute('href').slice(1));
  const isOpen = s => s && s.status !== 'done';
  const order = [...new Set([...shown.filter(slug => isOpen(sessions().find(s => s.slug === slug))), ...sessions().filter(isOpen).map(s => s.slug)])];
  if (!order.length) return;
  const i = order.indexOf(current()); // -1 (no open one shown): Ctrl+Tab takes the first, Ctrl+Shift+Tab the last
  const j = i < 0 ? (step > 0 ? 0 : order.length - 1) : (i + step + order.length) % order.length;
  location.hash = order[j];
}

// --- New items read: the session is shown and the window in the foreground ----------------------------------

const inForeground = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * Marks the new items of the displayed session as read if the developer is looking at it. `separator`: on opening
 * or when coming back to the window, the feed shows where they stopped (not while watching, each message would move it).
 */
export function markNewsRead(separator) {
  const slug = current(), d = detail();
  const n = sessions().find(s => s.slug === slug)?.unread;
  if (!n || d?.slug !== slug || !d.driven || !inForeground()) return;
  if (separator && d.seen?.id) placeSeparator(d.seen.id, n);
  markSeen(slug).catch(() => {});
}

/** Ctrl+Tab / Ctrl+Shift+Tab; new items read when coming back to the window. */
export function mountConversation() {
  addEventListener('focus', () => markNewsRead(true));
  document.addEventListener('visibilitychange', () => markNewsRead(true));
  addEventListener('keydown', e => {
    // Ctrl+Tab / Ctrl+Shift+Tab: next / previous open session (in the app; Chrome keeps this shortcut
    // for its tabs)
    if (e.ctrlKey && e.key === 'Tab' && !document.querySelector('.modal-backdrop, .viewer')) { e.preventDefault(); neighbourSession(e.shiftKey ? -1 : 1); }
  }, true);
}

// --- Center: header, conversation, input ----------------------------------------------------

function renderCenter(d) {
  const driven = d.driven;
  const shortcuts = t('conversation.center.shortcuts').split('|');
  $('#center').innerHTML = `
    <div class="head" id="head"></div>
    <div class="feed" id="feed">${driven ? '' : d.stopped
      ? `<p class="m">${t('conversation.center.stoppedDriven')}</p>`
      : `<p class="m">${t('conversation.center.terminal')}</p>${decisionCards(d.decisions || [], d.slug, true)}`}</div>
    <div class="activity" id="activity"></div>
    <div class="agent-banner" id="agent-banner"></div>
    <div class="input">
      <div class="command-menu" id="command-menu" hidden></div>
      <div class="attachments" id="attachments"></div>
      <textarea id="input" placeholder="${driven ? (matchMedia('(max-width: 900px)').matches ? t('conversation.center.placeholderMobile') : t('conversation.center.placeholder')) : t('conversation.center.placeholderTerminal')}"></textarea>
      <div class="bar">
        <div class="choices">${driven ? `<button class="btn" id="attach" title="${t('conversation.center.attach')}">📎</button><button class="btn mobile-only" id="take-photo" title="${t('conversation.center.photo')}">📷</button><input type="file" id="attach-file" multiple hidden><input type="file" id="attach-photo" accept="image/*" capture="environment" hidden>` : ''}${shortcuts.map(r => `<button class="btn" data-shortcut="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        <div class="actions" id="actions"></div>
      </div>
    </div>
    <div class="tabs" id="tabs"></div>`;
  renderHeader(d);
  $('#input').value = driven ? readDraft(d.slug).text : syncDraft(d.slug, d.decisions);
  if (!driven) attachDecisions($('#feed'));
  highlight();
  attachInput(d);
}

// --- Navigation and live updates ------------------------------------------------------------------


export async function show(slug) {
  const previous = current();
  current.set(slug || null);
  if ((slug || null) !== previous || !document.body.dataset.mobile) mobileView(slug ? 'conversation' : 'sessions'); // mobile: opening a session shows its conversation (not on every refresh)
  // Leaving the displayed session: nothing must rerender it anymore (10 s git poll, git read in progress)
  if (detail()?.slug !== slug) detail.set(null);
  $('#right').classList.remove('mode-git');
  if (slug === 'new' || slug?.startsWith('new?')) return renderNewSession(new URLSearchParams(slug.split('?')[1] || '').get('cwd'));
  if (!slug) {
    $('#center').innerHTML = `<div class="feed"><p class="m">${t('conversation.center.pickSession')}</p></div>`;
    $('#right').innerHTML = '';
    return;
  }
  // Another session: its skeleton (title already known from the list) replaces the old one while it arrives
  // (already a skeleton: a resume or a creation put it there, with the title the list does not know yet)
  if (slug !== previous) {
    if (!$('#center > .feed > .skeleton')) $('#center').innerHTML = sessionSkeleton(sessions().find(s => s.slug === slug)?.title);
    $('#right').innerHTML = skeleton('panel');
  }
  let read;
  try { read = await readSession(slug); } catch {
    if (current() !== slug) return;
    $('#center').innerHTML = `<div class="feed"><p class="m">${t('conversation.center.notFound')}</p></div>`;
    $('#right').innerHTML = '';
    return;
  }
  if (current() !== slug) return; // another session was chosen during the read: that one is shown
  detail.set(read);
  relativeDir.set(detail().cwd || null);
  if (lastRevealed !== slug) {
    lastRevealed = slug;
    if (!sessions().some(s => s.slug === slug)) await loadList(); // session just resumed or created: not in the list yet
    revealInTree(sessions().find(s => s.slug === slug) || detail());
  }
  renderCenter(detail());
  activity.set(detail().activity); renderActivity();
  forgetAgents();
  if (detail().driven) {
    if (slug !== previous) $('#feed').innerHTML = skeleton('feed');
    const feed = await readFeed(slug);
    if (current() !== slug) return;
    replaceFeed(feed);
    markNewsRead(true);
    // New session, no message yet: a welcome word and the cursor in the input
    if (!feed.length) {
      $('#feed').innerHTML = `<p class="m empty-home">${t('conversation.center.ready', { cwd: esc(detail().cwd || '') })}</p>`;
      $('#input')?.focus();
    }
  }
}

/** Updates the state without touching the feed or the input (except a terminal session, fully rerendered). */
export async function refresh() {
  try { detail.set(await readSession(current())); } catch { return show(null); }
  if (!detail().driven) return show(current());
  // The header and the send buttons rerender through their effect (detail changed)
}
