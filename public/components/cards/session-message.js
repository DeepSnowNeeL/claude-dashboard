// Message received from another session: purple card on the left, sender (link if it is a dashboard
// session) and content only, collapsed beyond about ten lines.
import { esc, rich } from '../../core/dom.js';
import { sessions } from '../../core/state.js';
import { t } from '../../i18n/index.js';

/**
 * Message received from another session: Claude Code messaging ("Another Claude session sent a message" +
 * <cross-session-message from-name=…>, followed by a standard warning) or the dashboard message_session tool
 * (<session-message from=… title=…>). Returns the sender and the useful content only, otherwise null.
 */
export function parseSessionMessage(text) {
  const s = String(text || '');
  const cc = s.match(/<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/);
  if (cc && /^\s*Another Claude session sent a message/.test(s)) {
    return { name: cc[1].match(/from-name="([^"]*)"/)?.[1] || t('cards.sessionMessage.unknown'), slug: null, text: cc[2].trim() };
  }
  const db = s.match(/^\s*<session-message from="([^"]*)" title="([^"]*)">\n?([\s\S]*?)\n?<\/session-message>\s*$/);
  return db ? { name: db[2] || db[1], slug: db[1], text: db[3].trim() } : null;
}

/** Fills `el` with the card of the `peer` message (result of parseSessionMessage) carried by the event `ev`. */
export function fillSessionMessage(el, ev, peer) {
  el.className = 'msg peer';
  const long = peer.text.split('\n').length > 10 || peer.text.length > 900;
  const from = peer.slug && sessions().some(s => s.slug === peer.slug)
    ? `<a href="#${esc(peer.slug)}">${esc(peer.name)}</a>` : `<b>${esc(peer.name)}</b>`;
  el.innerHTML = `<div class="peer-head">✉ ${t('cards.sessionMessage.from', { from })}${ev.queued ? ` <span class="m">${t('cards.sessionMessage.queued')}</span>` : ''}</div>
    <div class="peer-body ${long ? 'collapsed' : ''}">${rich(peer.text)}</div>
    ${long ? `<button class="link" data-show-all>${t('cards.sessionMessage.showAll')}</button>` : ''}`;
  el.querySelector('[data-show-all]')?.addEventListener('click', e => {
    const c = el.querySelector('.peer-body'); c.classList.toggle('collapsed');
    e.target.textContent = c.classList.contains('collapsed') ? t('cards.sessionMessage.showAll') : t('cards.sessionMessage.collapse');
  });
}
